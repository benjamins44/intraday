import https from 'https';
import { ExecutionBrokerPort } from '../../../../domain/ports/out/execution-broker.port';
import { PositionRepositoryPort } from '../../../../domain/ports/out/position-repository.port';
import { AssetRepositoryPort } from '../../../../domain/ports/out/asset-repository.port';
import { Position, PositionExitReason } from '../../../../domain/models/position.entity';
import { config } from '../../../../config/env.config';

export class Trading212BrokerAdapter implements ExecutionBrokerPort {
  private authHeader: string;
  private baseUrl: string;

  constructor(
    private positionRepo: PositionRepositoryPort,
    private assetRepo: AssetRepositoryPort
  ) {
    const creds = `${config.t212ApiKey}:${config.t212ApiSecret}`;
    this.authHeader = `Basic ${Buffer.from(creds).toString('base64')}`;
    this.baseUrl = config.t212ApiUrl || 'https://demo.trading212.com';
  }

  /**
   * Récupère le cash disponible réel depuis Trading 212 et le convertit en USD
   */
  async getT212CashInUSD(): Promise<{ availableCashUSD: number; totalValueUSD: number; currency: string; rateEurUsd: number }> {
    try {
      const summary = await this.fetchAccountSummary();
      const availableTradingCurrency = summary.cash?.availableToTrade ?? 1000;
      const totalTradingCurrency = summary.totalValue ?? availableTradingCurrency;
      const currency = (summary.currency || 'EUR').toUpperCase();

      let rateToUSD = 1.0;
      if (currency === 'EUR') {
        rateToUSD = await this.getLiveExchangeRate('EURUSD=X', 1.08);
      } else if (currency === 'GBP') {
        rateToUSD = await this.getLiveExchangeRate('GBPUSD=X', 1.28);
      }

      const availableCashUSD = parseFloat((availableTradingCurrency * rateToUSD).toFixed(2));
      const totalValueUSD = parseFloat((totalTradingCurrency * rateToUSD).toFixed(2));

      return {
        availableCashUSD,
        totalValueUSD,
        currency,
        rateEurUsd: rateToUSD
      };
    } catch (err: any) {
      console.warn(`[Trading 212] ⚠️ Impossible de récupérer le compte T212 (${err.message}). Utilisation du cash local.`);
      const local = await this.positionRepo.getPortfolioCash();
      return {
        availableCashUSD: local.availableCash,
        totalValueUSD: local.totalCapital,
        currency: 'USD',
        rateEurUsd: 1.0
      };
    }
  }

  /**
   * Synchronise en direct le cash réel du compte Trading 212 avec la BDD locale SQLite
   */
  async getLiveCash(): Promise<{ availableCash: number; totalCapital: number }> {
    const t212Cash = await this.getT212CashInUSD();
    try {
      await this.positionRepo.updatePortfolioCash(t212Cash.availableCashUSD);
    } catch {}
    return {
      availableCash: t212Cash.availableCashUSD,
      totalCapital: t212Cash.totalValueUSD
    };
  }

  /**
   * Ouvre une position : Passe l'ordre d'achat Market chez Trading 212 ET enregistre en BDD SQLite
   */
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
    // 1. Contrôle de solvabilité local
    const portfolio = await this.positionRepo.getPortfolioCash();
    if (allocatedCash > portfolio.availableCash) {
      throw new Error(
        `[Trading 212] ❌ Fonds insuffisants : Achat de ${allocatedCash.toFixed(2)}$ refusé (Cash dispo : ${portfolio.availableCash.toFixed(2)}$).`
      );
    }

    // 2. Recherche du ticker T212 associé
    const asset = await this.assetRepo.findBySymbol(symbol);
    const t212Ticker = asset?.t212Ticker || `${symbol}_US_EQ`;

    console.log(`[Trading 212] 📡 Transmission Ordre Achat Market : ${qty}x ${t212Ticker} (Ticker local: ${symbol})...`);

    let executedPrice = entryPrice;
    let executedQty = qty;

    // 3. Envoi de l'ordre d'achat chez Trading 212 (uniquement si LONG)
    if (side === 'LONG' && config.t212ApiKey) {
      try {
        const orderRes = await this.placeMarketOrder(t212Ticker, qty);
        console.log(`[Trading 212] ✅ Ordre Achat confirmé chez T212 (ID: ${orderRes.id || 'OK'})`);

        // Récupération immédiate du prix et de la quantité réels exécutés par T212
        if (orderRes.fillPrice || orderRes.avgPrice) {
          executedPrice = orderRes.fillPrice || orderRes.avgPrice;
          executedQty = orderRes.filledQuantity || qty;
        } else if (orderRes.id) {
          // Attente brève de 400ms pour récupérer le rapport d'exécution précis si disponible
          await new Promise((r) => setTimeout(r, 400));
          try {
            const details = await this.fetchOrderDetails(orderRes.id);
            if (details && (details.fillPrice || details.avgPrice || (details.filledValue && details.filledQuantity))) {
              executedPrice = details.fillPrice || details.avgPrice || (details.filledValue / details.filledQuantity);
              executedQty = details.filledQuantity || qty;
            }
          } catch {}
        }
      } catch (err: any) {
        console.error(`[Trading 212] ❌ Échec STRICT ordre Achat T212 sur ${t212Ticker} (${err.message}) -> Annulation de la position en BDD.`);
        throw new Error(`[Trading 212 Broker Error] Achat refusé par T212 sur ${t212Ticker}: ${err.message}`);
      }
    }

    // 4. Calcul précis du Stop-Loss, Take-Profit et Cash engagé basés sur le VRAI cours d'exécution T212
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const tp1Distance = Math.abs(takeProfit1 - entryPrice);
    const tp2Distance = takeProfit2 ? Math.abs(takeProfit2 - entryPrice) : undefined;

    const realStopLoss = parseFloat((side === 'LONG' ? executedPrice - stopDistance : executedPrice + stopDistance).toFixed(2));
    const realTakeProfit1 = parseFloat((side === 'LONG' ? executedPrice + tp1Distance : executedPrice - tp1Distance).toFixed(2));
    const realTakeProfit2 = tp2Distance ? parseFloat((side === 'LONG' ? executedPrice + tp2Distance : executedPrice - tp2Distance).toFixed(2)) : undefined;
    const realAllocatedCash = parseFloat((executedQty * executedPrice).toFixed(2));

    // Déduire le cash réel
    const newAvailableCash = parseFloat((portfolio.availableCash - realAllocatedCash).toFixed(2));
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    const position: Position = {
      symbol,
      exchange,
      side,
      entryPrice: executedPrice,
      currentPrice: executedPrice,
      qty: executedQty,
      allocatedCash: realAllocatedCash,
      stopLoss: realStopLoss,
      takeProfit1: realTakeProfit1,
      takeProfit2: realTakeProfit2,
      status: 'OPEN',
      entryTime: new Date(),
      tp1Executed: false,
      pnl: 0,
      pnlPercent: 0,
      scoreAtEntry
    };

    const saved = await this.positionRepo.save(position);
    console.log(`[Trading 212] 🚀 [ORDRE EXÉCUTÉ RÉEL] ID #${saved.id} -> ${side} ${executedQty}x ${symbol} [T212: ${t212Ticker}] @ ${executedPrice}$ (Estimé: ${entryPrice}$) | SL: ${realStopLoss}$ | TP1: ${realTakeProfit1}$ | Engagé: ${realAllocatedCash}$`);
    return saved;
  }

  /**
   * Clôture une position : Passe l'ordre de vente chez Trading 212 ET met à jour la BDD SQLite
   */
  async closePosition(
    positionId: number,
    exitPrice: number,
    reason: PositionExitReason
  ): Promise<Position> {
    const position = await this.positionRepo.findById(positionId);
    if (!position || position.status === 'CLOSED') {
      throw new Error(`Position ${positionId} non trouvée ou déjà fermée`);
    }

    // 1. Recherche du ticker T212 pour la vente
    const asset = await this.assetRepo.findBySymbol(position.symbol);
    const t212Ticker = asset?.t212Ticker || `${position.symbol}_US_EQ`;

    console.log(`[Trading 212] 📡 Transmission Ordre Vente Market : -${position.qty}x ${t212Ticker} (Raison: ${reason})...`);

    let finalExitPrice = exitPrice;

    // 2. Envoi de l'ordre de vente chez Trading 212 (quantité négative selon spec T212)
    if (config.t212ApiKey) {
      try {
        const orderRes = await this.placeMarketOrder(t212Ticker, -position.qty);
        console.log(`[Trading 212] ✅ Vente confirmée chez T212 (ID: ${orderRes.id || 'OK'})`);

        if (orderRes.fillPrice || orderRes.avgPrice) {
          finalExitPrice = orderRes.fillPrice || orderRes.avgPrice;
        } else if (orderRes.id) {
          await new Promise((r) => setTimeout(r, 400));
          try {
            const details = await this.fetchOrderDetails(orderRes.id);
            if (details && (details.fillPrice || details.avgPrice || (details.filledValue && details.filledQuantity))) {
              finalExitPrice = details.fillPrice || details.avgPrice || (details.filledValue / details.filledQuantity);
            }
          } catch {}
        }
      } catch (err: any) {
        console.error(`[Trading 212] ❌ Erreur lors de la vente T212 (${err.message})`);
      }
    }

    // 3. Calcul du P&L exact et mise à jour BDD locale
    let pnl = 0;
    if (position.side === 'LONG') {
      pnl = (finalExitPrice - position.entryPrice) * position.qty;
    } else {
      pnl = (position.entryPrice - finalExitPrice) * position.qty;
    }
    const pnlPercent = position.allocatedCash > 0 ? (pnl / position.allocatedCash) * 100 : 0;

    position.currentPrice = finalExitPrice;
    position.exitPrice = finalExitPrice;
    position.exitTime = new Date();
    position.exitReason = reason;
    position.status = 'CLOSED';
    position.pnl = parseFloat(pnl.toFixed(2));
    position.pnlPercent = parseFloat(pnlPercent.toFixed(2));

    await this.positionRepo.update(position);

    // 4. Recyclage du cash en BDD
    const portfolio = await this.positionRepo.getPortfolioCash();
    const returnedCash = Math.max(0, position.allocatedCash + pnl);
    const newAvailableCash = parseFloat((portfolio.availableCash + returnedCash).toFixed(2));
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    console.log(`[Trading 212] 🏁 [CLÔTURE EXÉCUTÉE] ID #${position.id} -> ${position.symbol} fermé @ ${finalExitPrice}$ [Raison: ${reason}] | P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$ (${pnlPercent.toFixed(2)}%)`);

    return position;
  }

  /**
   * Vente partielle (50% John Carter) chez Trading 212 et remontée du stop à Breakeven
   */
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

    // 1. Vente partielle chez Trading 212
    const asset = await this.assetRepo.findBySymbol(position.symbol);
    const t212Ticker = asset?.t212Ticker || `${position.symbol}_US_EQ`;

    console.log(`[Trading 212] 📡 Transmission Ordre Vente Partielle : -${actualCloseQty}x ${t212Ticker} (Raison: ${reason})...`);

    if (config.t212ApiKey) {
      try {
        const orderRes = await this.placeMarketOrder(t212Ticker, -actualCloseQty);
        console.log(`[Trading 212] ✅ Vente partielle confirmée chez T212 (ID: ${orderRes.id || 'OK'})`);
      } catch (err: any) {
        console.error(`[Trading 212] ❌ Erreur lors de la vente partielle T212 (${err.message})`);
      }
    }

    // 2. Calcul du P&L partiel et mise à jour locale
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
    position.stopLoss = position.entryPrice; // Remontée immédiate du Stop à Breakeven

    if (remainingQty === 0) {
      position.status = 'CLOSED';
      position.exitPrice = exitPrice;
      position.exitTime = new Date();
      position.exitReason = reason;
      position.pnl = parseFloat(partialPnl.toFixed(2));
    }

    await this.positionRepo.update(position);

    // 3. Recyclage du cash en BDD
    const portfolio = await this.positionRepo.getPortfolioCash();
    const returnedCash = Math.max(0, actualCloseQty * position.entryPrice + partialPnl);
    const newAvailableCash = parseFloat((portfolio.availableCash + returnedCash).toFixed(2));
    await this.positionRepo.updatePortfolioCash(newAvailableCash);

    console.log(
      `[Trading 212] 🎯 [VENTE PARTIELLE 50% JOHN CARTER] ID #${position.id} -> Vente de ${actualCloseQty}x ${position.symbol} @ ${exitPrice}$ (Solde restant: ${remainingQty}x | Stop remonté à Breakeven: ${position.entryPrice}$) | P&L partiel: ${partialPnl >= 0 ? '+' : ''}${partialPnl.toFixed(2)}$`
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

  /**
   * Appel HTTP vers l'API Trading 212 pour récupérer le résumé du compte
   */
  private fetchAccountSummary(): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/v0/equity/account/summary', this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          'User-Agent': 'IntradayTrader/1.0'
        },
        timeout: 8000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Réponse JSON invalide: ${data}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout appel compte T212'));
      });
      req.end();
    });
  }

  /**
   * Envoi d'un ordre Market (positif = Achat, négatif = Vente)
   */
  private placeMarketOrder(ticker: string, quantity: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/v0/equity/orders/market', this.baseUrl);
      const payload = JSON.stringify({
        ticker,
        quantity,
        extendedHours: true
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'IntradayTrader/1.0'
        },
        timeout: 8000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ status: 'OK', raw: data });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout ordre Market T212'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Récupère les détails d'un ordre spécifique par son ID (pour obtenir le cours d'exécution exact fillPrice)
   */
  private fetchOrderDetails(orderId: number | string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/v0/equity/orders/${orderId}`, this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          'User-Agent': 'IntradayTrader/1.0'
        },
        timeout: 6000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  /**
   * Taux de change en direct via Yahoo Finance (EURUSD=X ou GBPUSD=X)
   */
  private getLiveExchangeRate(pair: string, fallbackRate: number): Promise<number> {
    return new Promise((resolve) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=1d`;
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const price = json.chart.result[0].meta.regularMarketPrice;
            resolve(price || fallbackRate);
          } catch {
            resolve(fallbackRate);
          }
        });
      }).on('error', () => resolve(fallbackRate));
    });
  }
}
