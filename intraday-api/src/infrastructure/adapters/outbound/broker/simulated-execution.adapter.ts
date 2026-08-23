import { ExecutionBrokerPort } from '../../../../domain/ports/out/execution-broker.port';
import { PositionRepositoryPort } from '../../../../domain/ports/out/position-repository.port';
import { Position, PositionExitReason } from '../../../../domain/models/position.entity';

export class SimulatedExecutionAdapter implements ExecutionBrokerPort {
  constructor(private positionRepo: PositionRepositoryPort) {}

  async getLiveCash(): Promise<{ availableCash: number; totalCapital: number }> {
    return this.positionRepo.getPortfolioCash();
  }

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

  async partialClosePosition(
    positionId: number,
    closeQty: number,
    exitPrice: number,
    reason: PositionExitReason
  ): Promise<Position> {
    const position = await this.positionRepo.findById(positionId);
    if (!position || position.status === 'CLOSED') {
      throw new Error(`Position ${positionId} non trouvée ou déjà fermée`);
    }

    const actualCloseQty = Math.min(closeQty, position.qty);
    if (actualCloseQty <= 0) return position;

    // Calcul du P&L partiel
    let partialPnl = 0;
    if (position.side === 'LONG') {
      partialPnl = (exitPrice - position.entryPrice) * actualCloseQty;
    } else {
      partialPnl = (position.entryPrice - exitPrice) * actualCloseQty;
    }

    const remainingQty = position.qty - actualCloseQty;
    const remainingAllocatedCash = parseFloat((remainingQty * position.entryPrice).toFixed(2));

    position.currentPrice = exitPrice;
    position.qty = remainingQty;
    position.allocatedCash = remainingAllocatedCash;
    position.tp1Executed = true;
    // Règle John Carter : Remontée immédiate du Stop à Breakeven sur le solde restant
    position.stopLoss = position.entryPrice;

    if (remainingQty === 0) {
      position.status = 'CLOSED';
      position.exitPrice = exitPrice;
      position.exitTime = new Date();
      position.exitReason = reason;
      position.pnl = parseFloat(partialPnl.toFixed(2));
    }

    await this.positionRepo.update(position);

    // Recyclage du cash libéré par la vente partielle (capital engagé vendu + PnL réalisé)
    const portfolio = await this.positionRepo.getPortfolioCash();
    const returnedCash = Math.max(0, actualCloseQty * position.entryPrice + partialPnl);
    const newAvailableCash = parseFloat((portfolio.availableCash + returnedCash).toFixed(2));
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    console.log(
      `[Execution Broker] 🎯 [VENTE PARTIELLE 50% JOHN CARTER] ID #${position.id} -> Vente de ${actualCloseQty}x ${position.symbol} @ ${exitPrice}$ (Solde restant: ${remainingQty}x | Stop remonté à Breakeven: ${position.entryPrice}$) | P&L partiel: ${partialPnl >= 0 ? '+' : ''}${partialPnl.toFixed(2)}$`
    );

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
