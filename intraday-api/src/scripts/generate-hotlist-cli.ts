import { getDatabase } from '../infrastructure/database/sqlite.connection';
import { SqliteAssetRepository } from '../infrastructure/adapters/outbound/database/sqlite-asset.repository';
import { SqliteLogRepository } from '../infrastructure/adapters/outbound/database/sqlite-log.repository';
import { HybridMarketDataAdapter } from '../infrastructure/adapters/outbound/market-data/hybrid-market-data.adapter';
import { CarterIndicatorsService } from '../domain/services/carter-indicators.service';
import { GenerateHotListUseCase } from '../application/usecases/generate-hotlist.usecase';
import Table from 'cli-table3';

async function runHotListScreenerCLI() {
  console.log('='.repeat(75));
  console.log(' 🔥 GÉNÉRATION MANUELLE DE LA HOT LIST JOHN CARTER (50 ACTIFS)');
  console.log('='.repeat(75));

  getDatabase();

  const assetRepo = new SqliteAssetRepository();
  const logRepo = new SqliteLogRepository();
  const marketData = new HybridMarketDataAdapter();
  const indicatorsService = new CarterIndicatorsService();

  const generateHotListUseCase = new GenerateHotListUseCase(
    assetRepo,
    marketData,
    indicatorsService,
    logRepo
  );

  console.log('⏳ Scan en cours sur les 1 000 actifs de la base SQLite...');
  const result = await generateHotListUseCase.execute();

  console.log('\n📊 Résumé du Screener :');
  console.log(`- Total actifs analysés : ${result.totalAssetsScanned}`);
  console.log(`- Actions qualifiées en Hot List : ${result.qualifiedHotListCount} / 50`);

  if (result.hotList.length > 0) {
    const table = new Table({
      head: ['Rang', 'Ticker', 'Nom de l\'entreprise', 'Dernier Prix', 'Vol Moyen 50j', 'Statut'],
      colWidths: [8, 10, 32, 16, 18, 12]
    });

    result.hotList.forEach((asset, idx) => {
      table.push([
        asset.hotListRank || idx + 1,
        asset.symbol,
        asset.name.length > 28 ? asset.name.substring(0, 25) + '...' : asset.name,
        asset.lastPrice ? `${asset.lastPrice}$` : 'N/A',
        asset.avgVolume50d ? asset.avgVolume50d.toLocaleString() : 'N/A',
        '🔥 HOT'
      ]);
    });

    console.log('\n' + table.toString());
  }

  console.log('\n✅ La table "assets" a été mise à jour avec ces 50 actions pour le moteur 1-min.');
  console.log('='.repeat(75) + '\n');
  process.exit(0);
}

runHotListScreenerCLI().catch((err) => {
  console.error('❌ Erreur lors du scan Hot List :', err);
  process.exit(1);
});
