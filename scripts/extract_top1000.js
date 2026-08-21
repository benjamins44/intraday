const fs = require('fs');
const path = require('path');

async function generateActifs1000() {
  console.log('⏳ Lecture du fichier actions/russell2000.txt...');
  const inputPath = path.resolve(__dirname, '../actions/russell2000.txt');
  const outputPath = path.resolve(__dirname, '../actions/actifs1000.txt');

  const content = fs.readFileSync(inputPath, 'utf8');
  const blocks = content.split(/\n\s*\n/);

  console.log('📡 Téléchargement du référentiel officiel SEC des tickers US...');
  const secRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'Mozilla/5.0 IntradayResearch/1.0 (contact@example.com)' }
  });
  const secData = await secRes.json();
  const secList = Object.values(secData);

  function normalize(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|holdings|holding|group|class a|class b|class c|the)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const secMap = new Map();
  for (const s of secList) {
    const norm = normalize(s.title);
    if (norm && !secMap.has(norm)) {
      secMap.set(norm, s.ticker);
    }
  }

  const uniqueByTicker = new Map();

  for (const b of blocks) {
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let name = '';
    let var1d = 0;
    let var5d = 0;
    let varYtd = 0;
    let capi = '';

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('Ajouter') || l.startsWith('Capi') || l.startsWith('USD') || l.startsWith('Varia')) continue;
      if (l.startsWith('Action ')) {
        name = l.replace('Action ', '').trim();
      } else if (!name && !l.includes('%') && !l.includes('Md') && !l.includes('M ') && !l.includes('k ')) {
        name = l;
      }
      if (l.includes('Md') || l.includes('M ') || l.includes('k ')) {
        capi = l.split('\t')[0].trim();
      }
      const percentMatches = l.match(/([+-]?\d+[\.,]\d+|\d+)\s*%/g);
      if (percentMatches) {
        const vals = percentMatches.map(p => parseFloat(p.replace('%', '').replace(',', '.').trim()));
        if (vals.length > 0 && !var1d) var1d = vals[0];
        if (vals.length > 1 && !var5d) var5d = vals[1];
        if (vals.length > 2 && !varYtd) varYtd = vals[2];
      }
    }

    if (name) {
      const norm = normalize(name);
      let ticker = secMap.get(norm);
      if (!ticker) {
        for (const [k, v] of secMap.entries()) {
          if (norm.length > 3 && (k.startsWith(norm) || norm.startsWith(k))) {
            ticker = v;
            break;
          }
        }
      }
      if (ticker) {
        const absVar = Math.abs(var1d) || Math.abs(var5d) || 0;
        if (!uniqueByTicker.has(ticker) || uniqueByTicker.get(ticker).absVar < absVar) {
          uniqueByTicker.set(ticker, {
            name,
            ticker,
            var1d,
            var5d,
            varYtd,
            capi,
            absVar
          });
        }
      }
    }
  }

  const items = Array.from(uniqueByTicker.values());
  // Tri par plus forte variation absolue
  items.sort((a, b) => b.absVar - a.absVar);

  const top1000 = items.slice(0, 1000);

  // Format du fichier de sortie
  const outputLines = [
    '# TOP 1000 ACTIFS RUSSELL 2000 PAR FORTE VARIATION',
    '# FORMAT : NOM | TICKER | VARIATION 1J | VARIATION 5J | CAPI',
    ...top1000.map((x) => `${x.name} - ${x.ticker}\t${x.var1d >= 0 ? '+' : ''}${x.var1d}%\t${x.var5d >= 0 ? '+' : ''}${x.var5d}%\t${x.capi}`)
  ];

  fs.writeFileSync(outputPath, outputLines.join('\n'), 'utf8');

  console.log(`✅ Fichier ${outputPath} créé avec succès !`);
  console.log(`📊 Nombre d'actifs sélectionnés : ${top1000.length}`);
  console.log('\nTop 5 des plus fortes variations :');
  top1000.slice(0, 5).forEach((x, i) => {
    console.log(`  ${i + 1}. ${x.name} (${x.ticker}) : ${x.var1d >= 0 ? '+' : ''}${x.var1d}% (5j: ${x.var5d >= 0 ? '+' : ''}${x.var5d}%)`);
  });
}

generateActifs1000().catch(console.error);
