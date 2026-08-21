import { Position } from '../../models/position.entity';
import { MarketBreadth } from '../../models/market-breadth.entity';
import { CarterScore } from '../../models/scoring.entity';

export interface IntradayCycleResult {
  timestamp: Date;
  marketOpen: boolean;
  estTime: string;
  isSquareOffTriggered: boolean;
  marketBreadth?: MarketBreadth;
  openPositionsCount: number;
  openPositions: Position[];
  scannedHotListCount: number;
  scores: CarterScore[];
  executedTrade?: Position;
  closedPositions: Position[];
  portfolioCash: { totalCapital: number; availableCash: number; investedCash: number };
  message: string;
}

export interface ExecuteCycleUseCasePort {
  execute(currentTime?: Date, forceRun?: boolean): Promise<IntradayCycleResult>;
}
