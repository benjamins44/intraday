import { AiAdvisorPort } from '../../domain/ports/out/ai-advisor.port';
import { AiFeedbackRepositoryPort } from '../../domain/ports/out/ai-feedback-repository.port';
import { AssetRepositoryPort } from '../../domain/ports/out/asset-repository.port';
import { CarterSignal } from '../../domain/models/scoring.entity';
import { PreOrderAiDecision, PreOrderAiInput } from '../../domain/models/ai-feedback.entity';
import { config } from '../../config/env.config';

export class PreOrderAiFilterUseCase {
  constructor(
    private aiAdvisor: AiAdvisorPort,
    private feedbackRepo: AiFeedbackRepositoryPort,
    private assetRepo?: AssetRepositoryPort
  ) {}

  async evaluate(signal: CarterSignal, estTimeString: string): Promise<PreOrderAiDecision> {
    // Si désactivé par variable d'environnement, approbation immédiate sans coût/délai
    if (!config.enableAiPreOrderFilter) {
      return {
        symbol: signal.symbol,
        approve: true,
        confidence: 1.0,
        riskLevel: 'LOW',
        matchedPastFailurePattern: false,
        reason: 'Filtre IA Pré-Ordre désactivé (ENABLE_AI_PRE_ORDER_FILTER=false).'
      };
    }

    try {
      let sector = 'Général';
      if (this.assetRepo) {
        const asset = await this.assetRepo.findBySymbol(signal.symbol);
        if (asset && asset.sector) sector = asset.sector;
      }

      // Détermination du créneau horaire
      const estHour = parseInt(estTimeString.split(':')[0], 10) || 10;
      let timeSlot = 'MORNING';
      if (estHour < 10) timeSlot = 'OPENING';
      else if (estHour >= 12 && estHour < 14) timeSlot = 'LUNCH_CHOP';
      else if (estHour >= 14) timeSlot = 'AFTERNOON';

      // 1. RAG Ciblé : récupération des 3 à 5 leçons hiérarchisées
      const lessons = await this.feedbackRepo.findLessonsForContext(signal.symbol, sector, timeSlot, 5);
      const recentFeedbackLessons = lessons.map((l) => l.keyLesson);

      // Incrémentation de l'usage des leçons injectées
      for (const l of lessons) {
        if (l.id) this.feedbackRepo.incrementLessonUsage(l.id).catch(() => {});
      }

      const input: PreOrderAiInput = {
        symbol: signal.symbol,
        currentPrice: signal.currentPrice,
        currentTimeEST: estTimeString,
        squeezeState: signal.squeezeFired ? 'FIRED' : signal.inSqueeze ? 'IN_SQUEEZE' : 'NONE',
        momentum5m: signal.momentum,
        anchorTrend: signal.criteria.anchorTrendValid ? 'BULLISH_ALIGNED' : 'NOT_ALIGNED',
        momentum60m: signal.criteria.momentum60m,
        rvol: signal.rvol,
        stopLoss: signal.stopLossLevel,
        takeProfit1: signal.takeProfit1Level,
        riskRewardRatio: signal.criteria.riskRewardRatio,
        nyseAdd: signal.criteria.nyseAdd,
        nyseTick: signal.criteria.nyseTick,
        recentNewsHeadlines: [], // Hook possible avec RSS/News
        recentFeedbackLessons
      };

      console.log(`[Filtre IA Pré-Ordre] 🔍 Évaluation de sécurité sur ${signal.symbol} (${lessons.length} retours injectés)...`);
      const decision = await this.aiAdvisor.evaluatePreOrder(input);

      // Enregistrement en base de la décision d'arbitrage
      await this.feedbackRepo.savePreOrderDecision(decision);

      if (!decision.approve) {
        console.warn(`[Filtre IA Pré-Ordre] 🛑 ORDRE REJETÉ par l'IA sur ${signal.symbol} : ${decision.reason}`);
      } else {
        console.log(`[Filtre IA Pré-Ordre] 🟢 ORDRE APPROUVÉ par l'IA sur ${signal.symbol} (Confiance: ${(decision.confidence * 100).toFixed(0)}%)`);
      }

      return decision;
    } catch (err: any) {
      console.warn(`[Filtre IA Pré-Ordre] ⚠️ Erreur filtre IA : ${err.message} -> Approbation par défaut.`);
      return {
        symbol: signal.symbol,
        approve: true,
        confidence: 0.8,
        riskLevel: 'LOW',
        matchedPastFailurePattern: false,
        reason: 'Fallback auto en cas d erreur'
      };
    }
  }
}
