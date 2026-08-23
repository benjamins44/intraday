export type PositionSide = 'LONG' | 'SHORT';
export type PositionStatus = 'OPEN' | 'CLOSED';
export type PositionExitReason =
  | 'TP1'
  | 'TP1_PARTIAL'
  | 'TP2'
  | 'STOP_LOSS'
  | 'MOMENTUM_INVALIDATION'
  | 'SQUARE_OFF_1545'
  | 'MANUAL'
  | 'MANUAL_RESET';

export interface Position {
  id?: number;
  symbol: string;
  exchange?: string;
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  qty: number;
  allocatedCash: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  tp1Executed?: boolean;
  status: PositionStatus;
  entryTime: Date;
  exitPrice?: number;
  exitTime?: Date;
  exitReason?: PositionExitReason;
  pnl?: number;
  pnlPercent?: number;
  scoreAtEntry?: number;
}
