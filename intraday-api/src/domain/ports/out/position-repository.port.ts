import { Position, PositionStatus } from '../../models/position.entity';

export interface PositionRepositoryPort {
  save(position: Position): Promise<Position>;
  update(position: Position): Promise<Position>;
  findById(id: number): Promise<Position | null>;
  findOpenPositions(): Promise<Position[]>;
  findByStatus(status: PositionStatus): Promise<Position[]>;
  findAll(): Promise<Position[]>;
  countOpen(): Promise<number>;
  getPortfolioCash(): Promise<{ totalCapital: number; availableCash: number; investedCash: number }>;
  updatePortfolioCash(availableCash: number): Promise<void>;
  deleteAll(): Promise<void>;
}
