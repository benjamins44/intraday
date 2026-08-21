import { Position, PositionStatus } from '../../models/position.entity';

export interface ManagePositionsUseCasePort {
  getPositions(status?: PositionStatus): Promise<Position[]>;
  getPositionById(id: number): Promise<Position | null>;
  closePositionManually(id: number): Promise<Position>;
  squareOffAll(): Promise<Position[]>;
  getPortfolioSummary(): Promise<{
    totalCapital: number;
    availableCash: number;
    investedCash: number;
    openPositionsCount: number;
    totalPnl: number;
    openPositions: Position[];
    recentClosedPositions: Position[];
  }>;
  resetPortfolio(initialCapital?: number): Promise<{ message: string; availableCash: number; totalCapital: number }>;
}
