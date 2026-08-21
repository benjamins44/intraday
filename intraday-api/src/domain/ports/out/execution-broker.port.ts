import { Position, PositionExitReason } from '../../models/position.entity';

export interface ExecutionBrokerPort {
  openBracketPosition(
    symbol: string,
    exchange: string,
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    qty: number,
    allocatedCash: number,
    stopLoss: number,
    takeProfit1: number,
    scoreAtEntry: number,
    takeProfit2?: number
  ): Promise<Position>;

  closePosition(
    positionId: number,
    exitPrice: number,
    reason: PositionExitReason
  ): Promise<Position>;

  squareOffAllOpenPositions(currentPrices: Map<string, number>): Promise<Position[]>;

  getLiveCash?(): Promise<{ availableCash: number; totalCapital: number }>;
}
