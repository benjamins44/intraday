const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    if (cols.length >= 3) {
      rows.push({
        symbol: cols[0].trim(),
        name: cols[1].trim(),
        sector: cols[2].trim(),
        subIndustry: cols[3] ? cols[3].trim() : ''
      });
    }
  }
  return rows;
}

async function main() {
  const sp500CsvPath = path.resolve(__dirname, '../actions/sp500.csv');
  const t212Path = path.resolve(__dirname, '../intraday-api/t212_instruments.json');
  const dbPath = path.resolve(__dirname, '../intraday-api/data/intraday.db');
  const outputSqlPath = path.resolve(__dirname, 'insert_sp500_missing.sql');

  console.log('📂 Lecture du fichier S&P 500 :', sp500CsvPath);
  const sp500Rows = parseCSV(fs.readFileSync(sp500CsvPath, 'utf8'));
  console.log(`✅ ${sp500Rows.length} lignes extraites du CSV S&P 500`);

  // Récupération des instruments Trading 212
  console.log('📡 Lecture du catalogue Trading 212 :', t212Path);
  const t212Instruments = JSON.parse(fs.readFileSync(t212Path, 'utf8'));

  const t212MapByShortName = new Map();
  const t212MapByTicker = new Map();

  for (const inst of t212Instruments) {
    if (inst.ticker) {
      t212MapByTicker.set(inst.ticker.toUpperCase(), inst);
      if (inst.shortName) {
        const sn = inst.shortName.toUpperCase();
        const existing = t212MapByShortName.get(sn);
        // Priorité aux actions US libellées en USD ou finissant par _US_EQ
        if (!existing || inst.currencyCode === 'USD' || inst.ticker.endsWith('_US_EQ')) {
          t212MapByShortName.set(sn, inst);
        }
      }
    }
  }

  // Récupération des symboles existants en BDD via sqlite3 CLI
  console.log('🔍 Vérification des actifs existants en base SQLite...');
  let existingSymbols = new Set();
  try {
    const stdout = execSync(`sqlite3 "${dbPath}" "SELECT symbol FROM assets;"`, { encoding: 'utf8' });
    const symbols = stdout.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean);
    existingSymbols = new Set(symbols);
    console.log(`ℹ️ ${existingSymbols.size} actifs actuellement présents en BDD.`);
  } catch (err) {
    console.warn('⚠️ Impossible d\'interroger SQLite directement, les requêtes utiliseront ON CONFLICT DO NOTHING.');
  }

  // Filtrer les actifs manquants et résoudre le ticker T212
  const missingAssets = [];

  for (const item of sp500Rows) {
    // Normalisation Yahoo Finance : les points deviennent des tirets (ex: BRK-B, BF-B)
    const rawSymbol = item.symbol.toUpperCase();
    const yahooSymbol = rawSymbol.replace(/\./g, '-');
    const isAlreadyInDb = existingSymbols.has(yahooSymbol) || existingSymbols.has(rawSymbol);

    // Résolution du Ticker Trading 212
    let inst = t212MapByShortName.get(rawSymbol) || t212MapByShortName.get(yahooSymbol);
    if (!inst) {
      inst = t212MapByTicker.get(rawSymbol + '_US_EQ')
        || t212MapByTicker.get(rawSymbol.replace('.', '_') + '_US_EQ')
        || t212MapByTicker.get(rawSymbol.replace('.', '') + '_US_EQ')
        || t212MapByShortName.get(rawSymbol.replace('.', ''))
        || t212MapByShortName.get(rawSymbol.replace('.', '/'));
    }

    const t212Ticker = inst ? inst.ticker : `${rawSymbol.replace('.', '_')}_US_EQ`;

    // Détermination de la bourse (workingSchedule 56 = NYSE, 71/110 = NASDAQ)
    let exchange = 'NASDAQ';
    if (inst && inst.workingScheduleId === 56) {
      exchange = 'NYSE';
    } else if (inst && (inst.workingScheduleId === 71 || inst.workingScheduleId === 110)) {
      exchange = 'NASDAQ';
    } else {
      exchange = yahooSymbol.length <= 3 ? 'NYSE' : 'NASDAQ';
    }

    const assetData = {
      symbol: yahooSymbol,
      name: item.name,
      exchange,
      sector: item.sector,
      t212Ticker,
      isAlreadyInDb
    };

    if (!isAlreadyInDb) {
      missingAssets.push(assetData);
    }
  }

  console.log(`\n📊 Résumé de l'analyse :`);
  console.log(`  - Total S&P 500 : ${sp500Rows.length}`);
  console.log(`  - Déjà en BDD    : ${sp500Rows.length - missingAssets.length}`);
  console.log(`  - Manquants      : ${missingAssets.length}`);

  // Construction du contenu du fichier SQL
  const sqlHeader = [
    '--',
    '-- Script SQL d\'insertion des actifs S&P 500 manquants avec Ticker Trading 212',
    `-- Date de génération : ${new Date().toISOString()}`,
    `-- Total actifs à insérer : ${missingAssets.length}`,
    '--',
    'BEGIN TRANSACTION;',
    ''
  ];

  const missingSqlStatements = missingAssets.map(a => 
    `INSERT INTO assets (symbol, name, exchange, sector, avg_volume_50d, last_price, is_active, is_in_hotlist, hotlist_rank, t212_ticker, updated_at) VALUES (${escapeSql(a.symbol)}, ${escapeSql(a.name)}, ${escapeSql(a.exchange)}, ${escapeSql(a.sector)}, 0, 0, 1, 0, NULL, ${escapeSql(a.t212Ticker)}, CURRENT_TIMESTAMP) ON CONFLICT(symbol) DO NOTHING;`
  );

  const sqlFooter = [
    '',
    'COMMIT;',
    ''
  ];

  const fullSqlContent = [...sqlHeader, ...missingSqlStatements, ...sqlFooter].join('\n');
  fs.writeFileSync(outputSqlPath, fullSqlContent, 'utf8');
  console.log(`\n💾 Fichier SQL généré avec succès : ${outputSqlPath}`);
}

main().catch(err => {
  console.error('❌ Erreur lors de la génération SQL :', err);
  process.exit(1);
});
