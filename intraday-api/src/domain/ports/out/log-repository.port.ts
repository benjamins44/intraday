import { EngineLog, EngineCycleType } from '../../models/engine-log.entity';

export interface LogRepositoryPort {
  save(log: EngineLog): Promise<EngineLog>;
  findRecent(limit?: number, cycleType?: EngineCycleType): Promise<EngineLog[]>;
  getStats(): Promise<{
    totalCycles: number;
    totalTradesExecuted: number;
    lastCycleTime?: Date;
  }>;
}
