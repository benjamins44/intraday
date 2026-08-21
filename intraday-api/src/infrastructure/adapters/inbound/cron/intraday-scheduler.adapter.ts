import cron from 'node-cron';
import { ExecuteCycleUseCasePort } from '../../../../domain/ports/in/execute-cycle.usecase.port';
import { config } from '../../../../config/env.config';
import { MarketHoursService } from '../../../../domain/services/market-hours.service';

export class IntradaySchedulerAdapter {
  private isCycleRunning = false;

  constructor(private executeCycleUseCase: ExecuteCycleUseCasePort) {}

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
    console.log(`  - Expression Cron      : "${config.cron1mSchedule}" (Fuseau: America/New_York)`);
    console.log(`  - Statut Actuel        : ${marketStatus.reason}`);
    console.log(`================================================================\n`);

    // Cron 1-Minute : Boucle d'exécution intraday (Lundi-Vendredi pendant les heures US)
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
  }
}
