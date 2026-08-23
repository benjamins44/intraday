import { getDatabase } from './infrastructure/database/sqlite.connection';
import { SqliteAssetRepository } from './infrastructure/adapters/outbound/database/sqlite-asset.repository';
import { SqlitePositionRepository } from './infrastructure/adapters/outbound/database/sqlite-position.repository';
import { SqliteLogRepository } from './infrastructure/adapters/outbound/database/sqlite-log.repository';
import { HybridMarketDataAdapter } from './infrastructure/adapters/outbound/market-data/hybrid-market-data.adapter';
import { SimulatedExecutionAdapter } from './infrastructure/adapters/outbound/broker/simulated-execution.adapter';
import { CarterIndicatorsService } from './domain/services/carter-indicators.service';
import { ExecuteIntradayCycleUseCase } from './application/usecases/execute-intraday-cycle.usecase';

async function testSingleCycle() {
  console.log('🧪 Test d\'exécution d\'un cycle 1-minute avec journalisation...');
  getDatabase();

  const assetRepo = new SqliteAssetRepository();
  const positionRepo = new SqlitePositionRepository();
  const logRepo = new SqliteLogRepository();
  const marketData = new HybridMarketDataAdapter();
  const executionBroker = new SimulatedExecutionAdapter(positionRepo);
  const indicatorsService = new CarterIndicatorsService();

  const useCase = new ExecuteIntradayCycleUseCase(
    assetRepo,
    positionRepo,
    marketData,
    executionBroker,
    indicatorsService,
    logRepo
  );

  // 1. Test cycle avec force = true pour simuler un cycle en direct
  const result = await useCase.execute(new Date(), true);

  console.log('\n📊 Résultat du cycle :');
  console.log('- Statut :', result.message);
  console.log('- Durée / Marché :', result.marketOpen ? 'Ouvert (Forcé)' : 'Fermé', `(${result.estTime} EST)`);
  console.log('- Cash Portefeuille :', result.portfolioCash);
  console.log('- Positions Ouvertes :', result.openPositions.length);

  // 2. Vérification des logs enregistrés en SQLite
  const recentLogs = await logRepo.findRecent(3);
  console.log('\n📜 Derniers logs en base SQLite (table engine_logs) :');
  console.table(
    recentLogs.map((l) => ({
      ID: l.id,
      Type: l.cycleType,
      Statut: l.marketStatus,
      Décision: l.decision,
      Top: l.topCandidate ? `${l.topCandidate} (${l.topScore}/100)` : 'N/A',
      Trade: l.tradeExecuted || 'Aucun',
      'Durée (ms)': l.durationMs
    }))
  );

  process.exit(0);
}

testSingleCycle().catch((err) => {
  console.error('Erreur test :', err);
  process.exit(1);
});

testSingleCycle().catch((err) => {
  console.error('Erreur test :', err);
  process.exit(1);
});
