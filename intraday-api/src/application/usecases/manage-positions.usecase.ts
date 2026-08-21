import { ManagePositionsUseCasePort } from '../../domain/ports/in/manage-positions.usecase.port';
import { PositionRepositoryPort } from '../../domain/ports/out/position-repository.port';
import { ExecutionBrokerPort } from '../../domain/ports/out/execution-broker.port';
import { MarketDataPort } from '../../domain/ports/out/market-data.port';
import { Position, PositionStatus } from '../../domain/models/position.entity';

export class ManagePositionsUseCase implements ManagePositionsUseCasePort {
  constructor(
    private positionRepo: PositionRepositoryPort,
    private executionBroker: ExecutionBrokerPort,
    private marketData: MarketDataPort
  ) {}

  async getPositions(status?: PositionStatus): Promise<Position[]> {
    return status ? this.positionRepo.findByStatus(status) : this.positionRepo.findAll();
  }

  async getPositionById(id: number): Promise<Position | null> {
    return this.positionRepo.findById(id);
  }

  async closePositionManually(id: number): Promise<Position> {
    const pos = await this.positionRepo.findById(id);
    if (!pos) throw new Error(`Position ${id} non trouvée`);

    const q = await this.marketData.getQuote(pos.symbol);
    const exitPrice = q.price || pos.currentPrice;

    return this.executionBroker.closePosition(id, exitPrice, 'MANUAL');
  }

  async squareOffAll(): Promise<Position[]> {
    const openPositions = await this.positionRepo.findOpenPositions();
    const prices = new Map<string, number>();

    for (const p of openPositions) {
      const q = await this.marketData.getQuote(p.symbol);
      prices.set(p.symbol, q.price || p.currentPrice);
    }

    return this.executionBroker.squareOffAllOpenPositions(prices);
  }

  async getPortfolioSummary(): Promise<{
    totalCapital: number;
    availableCash: number;
    investedCash: number;
    openPositionsCount: number;
    totalPnl: number;
    openPositions: Position[];
    recentClosedPositions: Position[];
  }> {
    const openPositions = await this.positionRepo.findOpenPositions();
    const all = await this.positionRepo.findAll();
    const closedPositions = all
      .filter((p) => p.status === 'CLOSED')
      .sort((a, b) => {
        const timeA = a.exitTime ? a.exitTime.getTime() : a.entryTime.getTime();
        const timeB = b.exitTime ? b.exitTime.getTime() : b.entryTime.getTime();
        return timeB - timeA;
      });
    const realizedPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const recentClosed = closedPositions.slice(0, 10);

    // Calcul du P&L latent pour chaque position ouverte
    let latentPnlTotal = 0;
    for (const pos of openPositions) {
      const curPrice = pos.currentPrice || pos.entryPrice;
      const pnlLatent = pos.side === 'LONG'
        ? (curPrice - pos.entryPrice) * pos.qty
        : (pos.entryPrice - curPrice) * pos.qty;
      pos.pnl = parseFloat(pnlLatent.toFixed(2));
      pos.pnlPercent = pos.allocatedCash > 0 ? parseFloat(((pnlLatent / pos.allocatedCash) * 100).toFixed(2)) : 0;
      latentPnlTotal += pnlLatent;
    }

    const cash = await this.positionRepo.getPortfolioCash();
    const realInvested = openPositions.reduce((sum, p) => sum + p.allocatedCash, 0);
    const realAvailable = cash.availableCash;
    const realTotal = parseFloat((realAvailable + realInvested + latentPnlTotal).toFixed(2));

    return {
      totalCapital: realTotal,
      availableCash: parseFloat(realAvailable.toFixed(2)),
      investedCash: parseFloat(realInvested.toFixed(2)),
      openPositionsCount: openPositions.length,
      totalPnl: parseFloat((realizedPnl + latentPnlTotal).toFixed(2)),
      openPositions,
      recentClosedPositions: recentClosed
    };
  }

  async resetPortfolio(initialCapital = 1000): Promise<{ message: string; availableCash: number; totalCapital: number }> {
    // 1. Supprimer l'intégralité des positions (ouvertes et fermées)
    await this.positionRepo.deleteAll();

    // 2. Remettre le portefeuille à 1000$ (0$ investi)
    await this.positionRepo.updatePortfolioCash(initialCapital);

    return {
      message: `Portefeuille et historique des positions purgés avec succès (Capital: ${initialCapital}$).`,
      availableCash: initialCapital,
      totalCapital: initialCapital
    };
  }
}
