export type EngineCycleType = '1M_CYCLE' | 'HOTLIST_SCAN' | 'SQUARE_OFF' | 'MANUAL_RUN' | 'ERROR';

export interface EngineLog {
  id?: number;
  timestamp: Date;
  cycleType: EngineCycleType;
  marketStatus?: string;
  nyseTick?: number;
  nyseAdd?: number;
  trin?: number;
  spyPrice?: number;
  scannedCount: number;
  topCandidate?: string;
  topScore?: number;
  decision: string;
  tradeExecuted?: string;
  durationMs: number;
  detailsJson?: string;
}
