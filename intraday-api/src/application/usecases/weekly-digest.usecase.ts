import { PositionRepositoryPort } from '../../domain/ports/out/position-repository.port';
import { AiAdvisorPort } from '../../domain/ports/out/ai-advisor.port';
import { AiFeedbackRepositoryPort } from '../../domain/ports/out/ai-feedback-repository.port';
import { WeeklyDigestReport, WeeklyStatsInput } from '../../domain/models/ai-feedback.entity';

export class WeeklyDigestUseCase {
  constructor(
    private positionRepo: PositionRepositoryPort,
    private aiAdvisor: AiAdvisorPort,
    private feedbackRepo: AiFeedbackRepositoryPort
  ) {}

  async execute(lookbackDays = 7): Promise<WeeklyDigestReport | null> {
    try {
      const now = new Date();
      // Calcul du début de semaine (Lundi 00h00) pour couvrir l'intégralité des séances de la semaine
      const dayOfWeek = now.getDay(); // 0 = Dimanche, 1 = Lundi, 5 = Vendredi
      const distanceToMonday = (dayOfWeek + 6) % 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday, 0, 0, 0);
      const startDate = lookbackDays === 7 ? monday : new Date(now.getTime() - lookbackDays * 24 * 3600 * 1000);

      const history = await this.positionRepo.findByStatus('CLOSED');

      const recentTrades = history.filter((p) => {
        const exitTime = p.exitTime ? new Date(p.exitTime) : new Date(p.entryTime);
        return exitTime >= startDate;
      });

      if (recentTrades.length === 0) {
        console.log('[Weekly Digest AI] Aucun trade clôturé sur la période analysée.');
        return null;
      }

      let totalPnl = 0;
      let winningTrades = 0;
      let totalWinDollar = 0;
      let totalLossDollar = 0;

      // Répartition par créneau
      const slotStats = {
        open: { wins: 0, total: 0, pnl: 0 },
        morning: { wins: 0, total: 0, pnl: 0 },
        lunch: { wins: 0, total: 0, pnl: 0 },
        afternoon: { wins: 0, total: 0, pnl: 0 }
      };

      for (const t of recentTrades) {
        const pnl = t.pnl || 0;
        totalPnl += pnl;

        if (pnl > 0) {
          winningTrades++;
          totalWinDollar += pnl;
        } else {
          totalLossDollar += Math.abs(pnl);
        }

        const entryDate = new Date(t.entryTime);
        const estHour = (entryDate.getUTCHours() - 4 + 24) % 24;

        let slotKey: 'open' | 'morning' | 'lunch' | 'afternoon' = 'morning';
        if (estHour < 10) slotKey = 'open';
        else if (estHour >= 12 && estHour < 14) slotKey = 'lunch';
        else if (estHour >= 14) slotKey = 'afternoon';

        slotStats[slotKey].total++;
        slotStats[slotKey].pnl += pnl;
        if (pnl > 0) slotStats[slotKey].wins++;
      }

      const totalTrades = recentTrades.length;
      const winRate = (winningTrades / totalTrades) * 100;
      const profitFactor = totalLossDollar > 0 ? totalWinDollar / totalLossDollar : totalWinDollar > 0 ? 99 : 0;
      const avgWin = winningTrades > 0 ? totalWinDollar / winningTrades : 0;
      const losingTrades = totalTrades - winningTrades;
      const avgLoss = losingTrades > 0 ? totalLossDollar / losingTrades : 0;

      const calcWinRate = (slot: { wins: number; total: number }) => (slot.total > 0 ? (slot.wins / slot.total) * 100 : 0);

      const input: WeeklyStatsInput = {
        startDate: startDate.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
        totalTrades,
        winRate,
        profitFactor,
        avgWin,
        avgLoss,
        totalPnl,
        openWinRate: calcWinRate(slotStats.open),
        openPnl: slotStats.open.pnl,
        morningWinRate: calcWinRate(slotStats.morning),
        morningPnl: slotStats.morning.pnl,
        lunchWinRate: calcWinRate(slotStats.lunch),
        lunchPnl: slotStats.lunch.pnl,
        afternoonWinRate: calcWinRate(slotStats.afternoon),
        afternoonPnl: slotStats.afternoon.pnl,
        tradesSummary: recentTrades.map((t) => ({
          symbol: t.symbol,
          entry: t.entryPrice,
          exit: t.exitPrice,
          pnl: t.pnl,
          reason: t.exitReason,
          entryTime: t.entryTime
        }))
      };

      console.log(`\n[Weekly Digest AI] 📊 Génération de la synthèse hebdomadaire (${totalTrades} trades)...`);
      const digestResult = await this.aiAdvisor.generateWeeklyDigest(input);

      const report: WeeklyDigestReport = {
        startDate,
        endDate: now,
        totalTrades,
        winRate,
        profitFactor,
        totalPnl,
        reportMarkdown: digestResult.reportMarkdown,
        suggestedUpdatesJson: JSON.stringify(digestResult.suggestedConfigUpdates || {})
      };

      await this.feedbackRepo.saveWeeklyDigest(report);
      console.log('[Weekly Digest AI] ✅ Rapport hebdomadaire enregistré avec succès.');
      return report;
    } catch (err: any) {
      console.error('[Weekly Digest AI] ❌ Erreur lors de la synthèse hebdo :', err.message);
      return null;
    }
  }
}
