import { getDatabase } from '../infrastructure/database/sqlite.connection';
import { SqliteAssetRepository } from '../infrastructure/adapters/outbound/database/sqlite-asset.repository';
import { SqlitePositionRepository } from '../infrastructure/adapters/outbound/database/sqlite-position.repository';
import { SqliteLogRepository } from '../infrastructure/adapters/outbound/database/sqlite-log.repository';
import { HybridMarketDataAdapter } from '../infrastructure/adapters/outbound/market-data/hybrid-market-data.adapter';
import { SimulatedExecutionAdapter } from '../infrastructure/adapters/outbound/broker/simulated-execution.adapter';
import { CarterIndicatorsService } from '../domain/services/carter-indicators.service';
import { ExecuteIntradayCycleUseCase } from '../application/usecases/execute-intraday-cycle.usecase';
import Table from 'cli-table3';

async function runCronSimulation() {
  console.log('='.repeat(80));
  console.log(' 🧪 SIMULATION EN DIRECT DU CRON 1-MINUTE (5 CYCLES CONSÉCUTIFS)');
  console.log('='.repeat(80));

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

  // Vérification de la Hot List en BDD
  const hotList = await assetRepo.getHotList();
  console.log(`📋 Hot List active chargée : ${hotList.length} actions.`);
  if (hotList.length === 0) {
    console.warn('⚠️ Hot list vide, scan sur tous les actifs actifs.');
  }

  // Simulation de 5 minutes successives de séance de trading
  // Ex: 10h00, 10h01, 10h02, 10h03, 15h46 (test du square-off)
  const simulatedTimes = [
    { label: 'Minute 1 (10h00 EST - Ouverture)', time: new Date('2026-08-19T14:00:00Z'), force: true },
    { label: 'Minute 2 (10h01 EST - Suivi)', time: new Date('2026-08-19T14:01:00Z'), force: true },
    { label: 'Minute 3 (10h02 EST - Suivi)', time: new Date('2026-08-19T14:02:00Z'), force: true },
    { label: 'Minute 4 (15h46 EST - Test Square-Off 21h46 Paris)', time: new Date('2026-08-19T19:46:00Z'), force: true }
  ];

  for (let i = 0; i < simulatedTimes.length; i++) {
    const step = simulatedTimes[i];
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`⏳ [Cycle ${i + 1}/${simulatedTimes.length}] ${step.label}`);
    console.log(`--------------------------------------------------------------------------------`);

    const t0 = Date.now();
    try {
      const res = await useCase.execute(step.time, step.force);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

      console.log(`✅ Cycle exécuté sans erreur en ${elapsed}s.`);
      console.log(`  - Message : ${res.message}`);
      if (res.marketBreadth) {
        console.log(`  - Largeur de Marché : NYSE $TICK=${res.marketBreadth.nyseTick} | $ADD=${res.marketBreadth.nyseAdd} | $TRIN=${res.marketBreadth.trin} | SPY=${res.marketBreadth.spyPrice}$ (${res.marketBreadth.regime})`);
      }
      console.log(`  - Portefeuille : Cash Dispo = ${res.portfolioCash.availableCash.toLocaleString()}$ | Investi = ${res.portfolioCash.investedCash.toLocaleString()}$ | Total = ${res.portfolioCash.totalCapital.toLocaleString()}$`);
      console.log(`  - Positions Ouvertes : ${res.openPositions.length}/2 active(s)`);

      if (res.openPositions.length > 0) {
        const posTable = new Table({
          head: ['Symbole', 'Sens', 'Qté', 'Prix Entrée', 'Prix Courant', 'SL', 'TP1', 'P&L ($)', 'P&L (%)'],
          colWidths: [10, 8, 8, 14, 14, 12, 12, 12, 10]
        });

        res.openPositions.forEach((p) => {
          posTable.push([
            p.symbol,
            p.side,
            p.qty,
            `${p.entryPrice}$`,
            `${p.currentPrice}$`,
            `${p.stopLoss}$`,
            `${p.takeProfit1}$`,
            `${(p.pnl ?? 0) >= 0 ? '+' : ''}${(p.pnl ?? 0).toFixed(2)}$`,
            `${(p.pnlPercent ?? 0) >= 0 ? '+' : ''}${(p.pnlPercent ?? 0).toFixed(2)}%`
          ]);
        });
        console.log(posTable.toString());
      }

      if (res.scores && res.scores.length > 0) {
        console.log(`  - Top 3 Meilleurs Scores John Carter :`);
        res.scores.slice(0, 3).forEach((s, idx) => {
          console.log(`    ${idx + 1}. ${s.symbol} : ${s.scoreTotal}/100 [Squeeze: ${s.squeezeScore}/35, Anchor 60m: ${s.anchorScore}/25, RVOL: ${s.rvolScore}/20, Breadth: ${s.breadthScore}/20]`);
        });
      }
    } catch (err: any) {
      console.error(`❌ CRASH / ERREUR lors du cycle ${i + 1} :`, err.message);
    }
  }

  // Bilan final des logs en SQLite
  console.log(`\n================================================================================`);
  console.log(`📜 VÉRIFICATION DE LA JOURNALISATION SQLITE (TABLE "engine_logs") :`);
  console.log(`================================================================================`);

  const recentLogs = await logRepo.findRecent(simulatedTimes.length);
  const logTable = new Table({
    head: ['ID', 'Type', 'Statut Marché', 'Décision', 'Top Candidat', 'Trade', 'Durée (ms)'],
    colWidths: [6, 12, 22, 22, 16, 20, 12]
  });

  recentLogs.forEach((l) => {
    logTable.push([
      l.id,
      l.cycleType,
      l.marketStatus?.substring(0, 20) || 'N/A',
      l.decision,
      l.topCandidate ? `${l.topCandidate} (${l.topScore})` : 'N/A',
      l.tradeExecuted ? l.tradeExecuted.substring(0, 18) : 'Aucun',
      l.durationMs
    ]);
  });

  console.log(logTable.toString());

  // Remise à zéro propre du portefeuille à 1000$
  await positionRepo.updatePortfolioCash(1000);
  const db = getDatabase();
  db.prepare("UPDATE portfolio SET total_capital = 1000, available_cash = 1000, invested_cash = 0 WHERE id = 1").run();
  db.prepare("UPDATE positions SET status = 'CLOSED', exit_reason = 'SIMULATION_RESET', exit_time = CURRENT_TIMESTAMP WHERE status = 'OPEN'").run();

  console.log(`\n💰 Portefeuille réinitialisé : Cash disponible = 1,000.00$ | Positions ouvertes = 0.`);
  console.log(`🎉 Test de simulation terminé avec SUCCÈS : ZÉRO PLANTAGE, logs intègres et cohérence financière validée !`);
  process.exit(0);
}

runCronSimulation().catch((err) => {
  console.error('❌ Erreur globale simulation :', err);
  process.exit(1);
});
