import { Position } from '../../domain/models/position.entity';
import { PositionRepositoryPort } from '../../domain/ports/out/position-repository.port';
import { AiAdvisorPort } from '../../domain/ports/out/ai-advisor.port';
import { AiFeedbackRepositoryPort } from '../../domain/ports/out/ai-feedback-repository.port';
import { AssetRepositoryPort } from '../../domain/ports/out/asset-repository.port';
import { PostMortemAiInput, TradeFeedbackLesson, TradePostMortem } from '../../domain/models/ai-feedback.entity';

export class PostMortemTradeUseCase {
  constructor(
    private aiAdvisor: AiAdvisorPort,
    private feedbackRepo: AiFeedbackRepositoryPort,
    private assetRepo?: AssetRepositoryPort,
    private positionRepo?: PositionRepositoryPort
  ) {}

  /**
   * Exécution par lot quotidienne le soir (22h05 Paris / 16h05 EST)
   * Analyse tous les trades clôturés du jour qui n'ont pas encore de post-mortem.
   */
  async executeDailyBatch(): Promise<TradePostMortem[]> {
    if (!this.positionRepo) {
      console.warn('[Coach Quant AI] PositionRepository non fourni pour le batch quotidien.');
      return [];
    }

    const closedPositions = await this.positionRepo.findByStatus('CLOSED');
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const todayClosed = closedPositions.filter((p) => {
      const exitTime = p.exitTime ? new Date(p.exitTime) : new Date(p.entryTime);
      return exitTime >= startOfDay;
    });

    console.log(`\n[Coach Quant AI] 🌙 Démarrage du debriefing post-marché : ${todayClosed.length} trade(s) clôturé(s) aujourd'hui.`);

    const postMortems: TradePostMortem[] = [];
    for (const pos of todayClosed) {
      if (!pos.id) continue;
      const alreadyAnalyzed = await this.feedbackRepo.hasPostMortem(pos.id);
      if (alreadyAnalyzed) {
        console.log(`[Coach Quant AI] ⏭️ Trade #${pos.id} (${pos.symbol}) déjà analysé. Skip.`);
        continue;
      }

      const res = await this.execute(pos);
      if (res) postMortems.push(res);
    }

    console.log(`[Coach Quant AI] 🏁 Debriefing post-marché terminé : ${postMortems.length} nouveau(x) post-mortem(s) enregistré(s).\n`);
    return postMortems;
  }

  async execute(closedPosition: Position): Promise<TradePostMortem | null> {
    try {
      if (!closedPosition.id) return null;

      const entryDate = new Date(closedPosition.entryTime);
      const exitDate = closedPosition.exitTime ? new Date(closedPosition.exitTime) : new Date();
      const durationMin = Math.max(1, Math.round((exitDate.getTime() - entryDate.getTime()) / 60000));

      let sector = 'Général';
      if (this.assetRepo) {
        const asset = await this.assetRepo.findBySymbol(closedPosition.symbol);
        if (asset && asset.sector) sector = asset.sector;
      }

      // Détermination du créneau horaire
      const estHour = (entryDate.getUTCHours() - 4 + 24) % 24; // Approximation EST
      let timeSlot = 'MORNING';
      if (estHour < 10) timeSlot = 'OPENING';
      else if (estHour >= 12 && estHour < 14) timeSlot = 'LUNCH_CHOP';
      else if (estHour >= 14) timeSlot = 'AFTERNOON';

      const pnlDollar = closedPosition.pnl || 0;
      const pnlPercent = closedPosition.pnlPercent || 0;

      const input: PostMortemAiInput = {
        symbol: closedPosition.symbol,
        side: closedPosition.side,
        entryPrice: closedPosition.entryPrice,
        entryTime: entryDate.toISOString(),
        exitPrice: closedPosition.exitPrice || closedPosition.currentPrice,
        exitTime: exitDate.toISOString(),
        durationMinutes: durationMin,
        exitReason: closedPosition.exitReason || 'UNKNOWN',
        pnlDollar,
        pnlPercent,
        maxPriceReached: closedPosition.currentPrice, // estimation
        maxGainPercent: Math.max(0, pnlPercent),
        minPriceReached: closedPosition.stopLoss,
        initialStopLoss: closedPosition.stopLoss,
        finalStopLoss: closedPosition.stopLoss,
        marketBreadthTrend: 'NORMAL',
        sector
      };

      console.log(`\n[Coach Quant AI] 🧠 Analyse post-mortem du trade #${closedPosition.id} (${closedPosition.symbol}) en cours...`);
      const analysis = await this.aiAdvisor.analyzeTradePostMortem(input);

      const postMortem: TradePostMortem = {
        positionId: closedPosition.id,
        symbol: closedPosition.symbol,
        entryQuality: analysis.entryQuality,
        exitQuality: analysis.exitQuality,
        keyLesson: analysis.keyLesson,
        suggestedRuleUpdate: analysis.suggestedRuleUpdate
          ? JSON.stringify(analysis.suggestedRuleUpdate)
          : undefined,
        detailsJson: JSON.stringify(analysis)
      };

      await this.feedbackRepo.savePostMortem(postMortem);

      // Si le trade est perdant ou que la leçon est structurante, on enregistre une leçon réutilisable
      if (analysis.keyLesson && analysis.keyLesson.length > 5) {
        const lesson: TradeFeedbackLesson = {
          symbol: closedPosition.symbol,
          sector,
          timeSlot,
          failureCategory: pnlDollar < 0 ? 'LOSS_ANALYSIS' : 'WIN_LESSON',
          keyLesson: analysis.keyLesson,
          suggestedRuleUpdate: postMortem.suggestedRuleUpdate
        };
        await this.feedbackRepo.saveLesson(lesson);
      }

      console.log(`[Coach Quant AI] ✅ Leçon enregistrée : "${analysis.keyLesson}" (Entrée: ${analysis.entryQuality}, Sortie: ${analysis.exitQuality})`);
      return postMortem;
    } catch (err: any) {
      console.error(`[Coach Quant AI] ❌ Erreur lors du post-mortem (${closedPosition.symbol}) :`, err.message);
      return null;
    }
  }
}
