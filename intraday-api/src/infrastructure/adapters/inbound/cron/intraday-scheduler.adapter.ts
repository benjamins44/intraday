import cron from 'node-cron';
import { ExecuteCycleUseCasePort } from '../../../../domain/ports/in/execute-cycle.usecase.port';
import { config } from '../../../../config/env.config';
import { MarketHoursService } from '../../../../domain/services/market-hours.service';
import { PostMortemTradeUseCase } from '../../../../application/usecases/post-mortem-trade.usecase';
import { WeeklyDigestUseCase } from '../../../../application/usecases/weekly-digest.usecase';

export class IntradaySchedulerAdapter {
  private isCycleRunning = false;

  constructor(
    private executeCycleUseCase: ExecuteCycleUseCasePort,
    private postMortemTradeUseCase?: PostMortemTradeUseCase,
    private weeklyDigestUseCase?: WeeklyDigestUseCase
  ) {}

  public start() {
    if (!config.enableCron) {
      console.log('[Cron Adapter] ⏸️ Planificateur désactivé (ENABLE_CRON=false).');
      return;
    }

    const now = new Date();
    const marketStatus = MarketHoursService.getMarketStatus(now);
    const localTimeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    console.log(`\n================================================================`);
    console.log(`[Cron Adapter] ⏰ DÉMARRAGE DU PLANIFICATEUR INTRADAY`);
    console.log(`  - Heure Serveur Locale : ${localTimeStr}`);
    console.log(`  - Heure New York (EST) : ${marketStatus.estTimeString}`);
    console.log(`  - Cloche Ouverture US  : ${config.realMarketOpenEst} EST (15h30 Paris)`);
    console.log(`  - Début des Entrées    : ${config.marketOpenEst} EST (16h00 Paris - Fin Initial Balance)`);
    console.log(`  - Début Square-Off     : ${config.squareOffEst} EST (21h45 Paris - Clôture des positions)`);
    console.log(`  - Clôture Marché US    : ${config.marketCloseEst} EST (22h00 Paris)`);
    console.log(`  - Cron Cycle 1-Min     : "${config.cron1mSchedule}" (Fuseau: America/New_York)`);
    console.log(`  - Cron Coach Post-Trade: "${config.cronDailyPostMortemSchedule}" (22h05 Paris / 16h05 EST Lun-Ven)`);
    console.log(`  - Cron Synthèse Hebdo  : "${config.cronWeeklyDigestSchedule}" (22h15 Paris / 16h15 EST Vendredi)`);
    console.log(`  - Statut Actuel        : ${marketStatus.reason}`);
    console.log(`================================================================\n`);

    // 1. Cron 1-Minute : Boucle d'exécution intraday (Lundi-Vendredi pendant les heures US)
    cron.schedule(
      config.cron1mSchedule,
      async () => {
        if (this.isCycleRunning) {
          console.warn('[Cron Adapter] ⚠️ Le cycle précédent est toujours en cours d\'exécution. Skip.');
          return;
        }

        this.isCycleRunning = true;
        try {
          await this.executeCycleUseCase.execute();
        } catch (err: any) {
          console.error('[Cron Adapter] ❌ Erreur lors du cycle 1-min :', err.message);
        } finally {
          this.isCycleRunning = false;
        }
      },
      { timezone: 'America/New_York' }
    );

    // 2. Cron Quotidien Post-Marché (22h05 Paris / 16h05 EST) : Debriefing & Post-Mortem IA
    if (this.postMortemTradeUseCase && config.enableAiPostMortem) {
      cron.schedule(
        config.cronDailyPostMortemSchedule,
        async () => {
          try {
            console.log('\n[Cron Adapter] 🌙 Déclenchement du cron quotidien Coach Quant Post-Marché (22h05 Paris)...');
            await this.postMortemTradeUseCase!.executeDailyBatch();
          } catch (err: any) {
            console.error('[Cron Adapter] ❌ Erreur lors du post-mortem quotidien :', err.message);
          }
        },
        { timezone: 'America/New_York' }
      );
    }

    // 3. Cron Hebdomadaire (Vendredi 22h15 Paris / 16h15 EST) : Rapport de synthèse de toute la semaine
    if (this.weeklyDigestUseCase && config.enableAiPostMortem) {
      cron.schedule(
        config.cronWeeklyDigestSchedule,
        async () => {
          try {
            console.log('\n[Cron Adapter] 📊 Déclenchement du cron hebdomadaire Synthèse & Auto-Tuning (Vendredi 22h15 Paris)...');
            await this.weeklyDigestUseCase!.execute(7);
          } catch (err: any) {
            console.error('[Cron Adapter] ❌ Erreur lors de la synthèse hebdomadaire :', err.message);
          }
        },
        { timezone: 'America/New_York' }
      );
    }
  }
}
