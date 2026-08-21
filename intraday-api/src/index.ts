import { config } from './config/env.config';
import { getDatabase } from './infrastructure/database/sqlite.connection';
import { SqliteAssetRepository } from './infrastructure/adapters/outbound/database/sqlite-asset.repository';
import { SqlitePositionRepository } from './infrastructure/adapters/outbound/database/sqlite-position.repository';
import { SqliteLogRepository } from './infrastructure/adapters/outbound/database/sqlite-log.repository';
import { HybridMarketDataAdapter } from './infrastructure/adapters/outbound/market-data/hybrid-market-data.adapter';
import { Trading212BrokerAdapter } from './infrastructure/adapters/outbound/broker/trading212-broker.adapter';
import { CarterIndicatorsService } from './domain/services/carter-indicators.service';

// Use Cases
import { ManageAssetsUseCase, DEFAULT_TOP_US_STOCKS } from './application/usecases/manage-assets.usecase';
import { ManagePositionsUseCase } from './application/usecases/manage-positions.usecase';
import { ExecuteIntradayCycleUseCase } from './application/usecases/execute-intraday-cycle.usecase';
import { GenerateHotListUseCase } from './application/usecases/generate-hotlist.usecase';

// Inbound Adapters
import { createHttpServer } from './infrastructure/adapters/inbound/http/server';
import { IntradaySchedulerAdapter } from './infrastructure/adapters/inbound/cron/intraday-scheduler.adapter';
import { Asset } from './domain/models/asset.entity';

async function bootstrap() {
  console.log('='.repeat(70));
  console.log(' 🚀 DÉMARRAGE DE INTRADAY-API (ARCHITECTURE HEXAGONALE - JOHN CARTER)');
  console.log('='.repeat(70));

  // 1. Initialisation SQLite
  getDatabase();
  console.log(`[DB] Base SQLite initialisée (${config.databasePath})`);

  // 2. Instanciation des Adaptateurs Sortants (Outbound)
  const assetRepo = new SqliteAssetRepository();
  const positionRepo = new SqlitePositionRepository();
  const logRepo = new SqliteLogRepository();
  const marketData = new HybridMarketDataAdapter();
  const executionBroker = new Trading212BrokerAdapter(positionRepo, assetRepo);
  const indicatorsService = new CarterIndicatorsService();

  // Synchronisation initiale du cash T212 si configuré
  if (config.t212ApiKey) {
    executionBroker.getT212CashInUSD().then((t212Cash) => {
      console.log(`[Trading 212] 💼 Compte connecté (${t212Cash.currency}) | Cash disponible converti en USD : ${t212Cash.availableCashUSD}$ (Taux: ${t212Cash.rateEurUsd})`);
      positionRepo.updatePortfolioCash(t212Cash.availableCashUSD).catch(() => {});
    });
  }

  // 3. Auto-seed et synchronisation complète des actifs et tickers T212
  const manageAssetsUseCase = new ManageAssetsUseCase(assetRepo);
  const currentAssetCount = await assetRepo.count();
  if (currentAssetCount < 1000) {
    console.log(`[Seed] Initialisation automatique de l'univers Russell 2000 avec tickers Trading 212...`);
    const seedResult = await manageAssetsUseCase.seedTopUSAssets();
    console.log(`[Seed] ✅ Univers synchronisé : ${seedResult.insertedCount} actifs insérés (Total : ${seedResult.totalCount}).`);
  }
  const managePositionsUseCase = new ManagePositionsUseCase(positionRepo, executionBroker, marketData);
  const executeCycleUseCase = new ExecuteIntradayCycleUseCase(
    assetRepo,
    positionRepo,
    marketData,
    executionBroker,
    indicatorsService,
    logRepo
  );
  const generateHotListUseCase = new GenerateHotListUseCase(assetRepo, marketData, indicatorsService, logRepo);

  // 5. Instanciation et Démarrage du Planificateur Cron (Cycle 1-minute uniquement)
  const scheduler = new IntradaySchedulerAdapter(executeCycleUseCase);
  scheduler.start();

  // 6. Démarrage du Serveur Express HTTP
  const app = createHttpServer(
    manageAssetsUseCase,
    managePositionsUseCase,
    executeCycleUseCase,
    generateHotListUseCase,
    marketData,
    logRepo
  );

  app.listen(config.port, () => {
    console.log(`[HTTP] Serveur Express en écoute sur http://localhost:${config.port}`);
    console.log(`  - Health Check     : GET  http://localhost:${config.port}/health`);
    console.log(`  - Liste Actifs     : GET  http://localhost:${config.port}/api/assets`);
    console.log(`  - Ajouter Actif    : POST http://localhost:${config.port}/api/assets (Body: { symbol, name, exchange, sector?, t212Ticker? })`);
    console.log(`  - Hot List         : GET  http://localhost:${config.port}/api/assets/hotlist`);
    console.log(`  - Positions & Cash : GET  http://localhost:${config.port}/api/positions/summary`);
    console.log(`  - Cycle 1-Min Moteur: POST http://localhost:${config.port}/api/engine/run-cycle`);
    console.log('='.repeat(70) + '\n');
  });
}

bootstrap().catch((err) => {
  console.error('❌ Erreur fatale au démarrage de intraday-api :', err);
  process.exit(1);
});
