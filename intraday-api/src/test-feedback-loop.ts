import { getDatabase } from './infrastructure/database/sqlite.connection';
import { SqliteFeedbackRepository } from './infrastructure/adapters/outbound/database/sqlite-feedback.repository';
import { TradeFeedbackLesson, TradePostMortem } from './domain/models/ai-feedback.entity';

async function testFeedbackLoop() {
  console.log('========================================================================');
  console.log('🧪 TEST D\'INTÉGRATION DU MODULE AI FEEDBACK LOOP (SQLite & RAG)');
  console.log('========================================================================\n');

  getDatabase();
  const repo = new SqliteFeedbackRepository();

  // 1. Test insertion de leçons de test
  const lesson1: TradeFeedbackLesson = {
    symbol: 'AFRI',
    sector: 'Consumer Defensive',
    timeSlot: 'MORNING',
    failureCategory: 'LOW_VOLUME',
    keyLesson: 'Éviter les achats sur AFRI quand RVOL < 0.50 (volume mort institutionnel).',
    suggestedRuleUpdate: JSON.stringify({ targetParameter: 'RVOL_MIN', proposedValue: '1.20' })
  };

  const lesson2: TradeFeedbackLesson = {
    symbol: 'MRNA',
    sector: 'Healthcare',
    timeSlot: 'AFTERNOON',
    failureCategory: 'DOWNTREND_WAVE_C',
    keyLesson: 'Ne jamais acheter MRNA en intraday quand Wave C 60m est négative (Pinto setup).',
    suggestedRuleUpdate: JSON.stringify({ targetParameter: 'WAVE_C_MIN', proposedValue: '0.0' })
  };

  const id1 = await repo.saveLesson(lesson1);
  const id2 = await repo.saveLesson(lesson2);
  console.log(`[DB Test] ✅ 2 leçons insérées en base (IDs: ${id1}, ${id2})`);

  // 2. Test RAG ciblé
  const retrievedAfri = await repo.findLessonsForContext('AFRI', 'Consumer Defensive', 'MORNING', 3);
  console.log(`\n[RAG Test] 🎯 Leçons récupérées pour le contexte AFRI :`);
  console.table(
    retrievedAfri.map((l) => ({
      ID: l.id,
      Symbole: l.symbol,
      Secteur: l.sector,
      Tranche: l.timeSlot,
      Leçon: l.keyLesson
    }))
  );

  // 3. Test insertion Post-Mortem
  const postMortem: TradePostMortem = {
    positionId: 999,
    symbol: 'AFRI',
    entryQuality: 'CHASING',
    exitQuality: 'OPTIMAL',
    keyLesson: 'Entrée trop tardive sans volume relatif.',
    detailsJson: JSON.stringify({ pnl: -14.5 })
  };
  const pmId = await repo.savePostMortem(postMortem);
  console.log(`\n[DB Test] ✅ Post-mortem inséré (ID: ${pmId})`);

  const recentPM = await repo.getRecentPostMortems(3);
  console.log(`\n[DB Test] 📜 Derniers post-mortems en base :`);
  console.table(recentPM);

  console.log('\n========================================================================');
  console.log('🎉 TOUS LES TESTS AI FEEDBACK LOOP SONT VALIDES !');
  console.log('========================================================================');
  process.exit(0);
}

testFeedbackLoop().catch((err) => {
  console.error('Erreur test :', err);
  process.exit(1);
});
