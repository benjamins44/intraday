import cron from 'node-cron';
import { ExecuteCycleUseCasePort } from '../../../../domain/ports/in/execute-cycle.usecase.port';
import { config } from '../../../../config/env.config';

export class IntradaySchedulerAdapter {
  private isCycleRunning = false;

  constructor(private executeCycleUseCase: ExecuteCycleUseCasePort) {}

  public start() {
    if (!config.enableCron) {
      console.log('[Cron Adapter] ⏸️ Planificateur désactivé (ENABLE_CRON=false).');
      return;
    }

    console.log(`[Cron Adapter] ⏰ Planificateur démarré.`);
    console.log(`  - Cycle 1-min : "${config.cron1mSchedule}"`);

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
