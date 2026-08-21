import { ExecutionBrokerPort } from '../../../../domain/ports/out/execution-broker.port';
import { PositionRepositoryPort } from '../../../../domain/ports/out/position-repository.port';
import { Position, PositionExitReason } from '../../../../domain/models/position.entity';

export class SimulatedExecutionAdapter implements ExecutionBrokerPort {
  constructor(private positionRepo: PositionRepositoryPort) {}

  async openBracketPosition(
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
  ): Promise<Position> {
    // 1. Contrôle strict de solvabilité : impossible d'engager plus que le cash disponible
    const portfolio = await this.positionRepo.getPortfolioCash();
    if (allocatedCash > portfolio.availableCash) {
      throw new Error(
        `[Execution Broker] ❌ Fonds insuffisants : Achat de ${allocatedCash.toFixed(2)}$ refusé (Cash disponible : ${portfolio.availableCash.toFixed(2)}$).`
      );
    }

    const newAvailableCash = parseFloat((portfolio.availableCash - allocatedCash).toFixed(2));
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    // 2. Enregistrer la position
    const position: Position = {
      symbol,
      exchange,
      side,
      entryPrice,
      currentPrice: entryPrice,
      qty,
      allocatedCash,
      stopLoss,
      takeProfit1,
      takeProfit2: takeProfit2 || undefined,
      status: 'OPEN',
      entryTime: new Date(),
      tp1Executed: false,
      pnl: 0,
      pnlPercent: 0,
      scoreAtEntry
    };

    const saved = await this.positionRepo.save(position);
    console.log(`[Execution Broker] 🚀 [ORDRE EXÉCUTÉ] ID #${saved.id} -> ${side} ${qty}x ${symbol} (${exchange}) @ ${entryPrice}$ | SL: ${stopLoss}$ | TP1: ${takeProfit1}$ | Engagé: ${allocatedCash}$`);
    return saved;
  }

  async closePosition(
    positionId: number,
    exitPrice: number,
    reason: PositionExitReason
  ): Promise<Position> {
    const position = await this.positionRepo.findById(positionId);
    if (!position || position.status === 'CLOSED') {
      throw new Error(`Position ${positionId} non trouvée ou déjà fermée`);
    }

    // Calcul du P&L
    let pnl = 0;
    if (position.side === 'LONG') {
      pnl = (exitPrice - position.entryPrice) * position.qty;
    } else {
      pnl = (position.entryPrice - exitPrice) * position.qty;
    }
    const pnlPercent = position.allocatedCash > 0 ? (pnl / position.allocatedCash) * 100 : 0;

    position.currentPrice = exitPrice;
    position.exitPrice = exitPrice;
    position.exitTime = new Date();
    position.exitReason = reason;
    position.status = 'CLOSED';
    position.pnl = parseFloat(pnl.toFixed(2));
    position.pnlPercent = parseFloat(pnlPercent.toFixed(2));

    await this.positionRepo.update(position);

    // 3. Recyclage du cash : réinjecter le capital initial + PnL dans le portefeuille
    const portfolio = await this.positionRepo.getPortfolioCash();
    const returnedCash = Math.max(0, position.allocatedCash + pnl);
    const newAvailableCash = portfolio.availableCash + returnedCash;
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    console.log(`[Execution Broker] 🏁 [CLÔTURE EXÉCUTÉE] ID #${position.id} -> ${position.symbol} (${position.side}) fermé @ ${exitPrice}$ [Raison: ${reason}] | P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$ (${pnlPercent.toFixed(2)}%)`);

    return position;
  }

  async squareOffAllOpenPositions(currentPrices: Map<string, number>): Promise<Position[]> {
    const openPositions = await this.positionRepo.findOpenPositions();
    const closed: Position[] = [];

    for (const pos of openPositions) {
      const exitPrice = currentPrices.get(pos.symbol) || pos.currentPrice;
      const closedPos = await this.closePosition(pos.id!, exitPrice, 'SQUARE_OFF_1545');
      closed.push(closedPos);
    }

    return closed;
  }
}
