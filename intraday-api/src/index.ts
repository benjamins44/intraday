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

// AI & Feedback Loop (AI_FEEDBACK_LOOP.md)
import { SqliteFeedbackRepository } from './infrastructure/adapters/outbound/database/sqlite-feedback.repository';
import { AntigravityGeminiAdapter } from './infrastructure/adapters/outbound/ai/antigravity-gemini.adapter';
import { PostMortemTradeUseCase } from './application/usecases/post-mortem-trade.usecase';
import { WeeklyDigestUseCase } from './application/usecases/weekly-digest.usecase';
import { PreOrderAiFilterUseCase } from './application/usecases/pre-order-ai-filter.usecase';

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

  // 3. Adaptateurs & UseCases IA & Feedback Loop (AI_FEEDBACK_LOOP.md)
  const feedbackRepo = new SqliteFeedbackRepository();
  const aiAdvisor = new AntigravityGeminiAdapter();
  const postMortemTradeUseCase = new PostMortemTradeUseCase(aiAdvisor, feedbackRepo, assetRepo, positionRepo);
  const weeklyDigestUseCase = new WeeklyDigestUseCase(positionRepo, aiAdvisor, feedbackRepo);
  const preOrderAiFilterUseCase = new PreOrderAiFilterUseCase(aiAdvisor, feedbackRepo, assetRepo);

  // 4. Auto-seed et synchronisation complète de l'univers S&P 500 avec tickers T212
  const manageAssetsUseCase = new ManageAssetsUseCase(assetRepo);
  const currentAssetCount = await assetRepo.count();
  if (currentAssetCount < 490 || currentAssetCount > 515) {
    console.log(`[Seed] 🏛️ Réinitialisation stricte de l'univers : chargement des 503 actions du S&P 500...`);
    const seedResult = await manageAssetsUseCase.seedTopUSAssets();
    console.log(`[Seed] ✅ Univers S&P 500 synchronisé : ${seedResult.insertedCount} actifs insérés (Total : ${seedResult.totalCount}).`);
  }
  const managePositionsUseCase = new ManagePositionsUseCase(positionRepo, executionBroker, marketData);
  const executeCycleUseCase = new ExecuteIntradayCycleUseCase(
    assetRepo,
    positionRepo,
    marketData,
    executionBroker,
    indicatorsService,
    logRepo,
    postMortemTradeUseCase,
    preOrderAiFilterUseCase
  );
  const generateHotListUseCase = new GenerateHotListUseCase(assetRepo, marketData, indicatorsService, logRepo);

  // 5. Instanciation et Démarrage du Planificateur Cron (1-Min, Post-Marché 22h05 & Hebdo 22h15)
  const scheduler = new IntradaySchedulerAdapter(
    executeCycleUseCase,
    postMortemTradeUseCase,
    weeklyDigestUseCase
  );
  scheduler.start();

  // 6. Démarrage du Serveur Express HTTP
  const app = createHttpServer(
    manageAssetsUseCase,
    managePositionsUseCase,
    executeCycleUseCase,
    generateHotListUseCase,
    marketData,
    logRepo,
    postMortemTradeUseCase,
    weeklyDigestUseCase,
    feedbackRepo,
    positionRepo
  );

  app.listen(config.port, () => {
    console.log(`[HTTP] Serveur Express en écoute sur http://localhost:${config.port}`);
    console.log(`  - Health Check     : GET  http://localhost:${config.port}/health`);
    console.log(`  - Liste Actifs     : GET  http://localhost:${config.port}/api/assets`);
    console.log(`  - Positions & Cash : GET  http://localhost:${config.port}/api/positions/summary`);
    console.log(`  - Cycle 1-Min      : POST http://localhost:${config.port}/api/engine/run-cycle`);
    console.log(`  - AI Leçons RAG    : GET  http://localhost:${config.port}/api/feedback/lessons`);
    console.log(`  - AI Post-Mortems  : GET  http://localhost:${config.port}/api/feedback/post-mortems`);
    console.log(`  - AI Weekly Digest : POST http://localhost:${config.port}/api/feedback/weekly-digest`);
    console.log('='.repeat(70) + '\n');
  });
}

bootstrap().catch((err) => {
  console.error('❌ Erreur fatale au démarrage de intraday-api :', err);
  process.exit(1);
});
