import {
  ExecuteCycleUseCasePort,
  IntradayCycleResult
} from '../../domain/ports/in/execute-cycle.usecase.port';
import { AssetRepositoryPort } from '../../domain/ports/out/asset-repository.port';
import { PositionRepositoryPort } from '../../domain/ports/out/position-repository.port';
import { MarketDataPort } from '../../domain/ports/out/market-data.port';
import { ExecutionBrokerPort } from '../../domain/ports/out/execution-broker.port';
import { CarterIndicatorsService } from '../../domain/services/carter-indicators.service';
import { Position } from '../../domain/models/position.entity';
import { CarterScore } from '../../domain/models/scoring.entity';
import { config } from '../../config/env.config';

import { LogRepositoryPort } from '../../domain/ports/out/log-repository.port';
import { MarketHoursService } from '../../domain/services/market-hours.service';
import { PostMortemTradeUseCase } from './post-mortem-trade.usecase';
import { PreOrderAiFilterUseCase } from './pre-order-ai-filter.usecase';

export class ExecuteIntradayCycleUseCase implements ExecuteCycleUseCasePort {
  constructor(
    private assetRepo: AssetRepositoryPort,
    private positionRepo: PositionRepositoryPort,
    private marketData: MarketDataPort,
    private executionBroker: ExecutionBrokerPort,
    private indicatorsService: CarterIndicatorsService,
    private logRepo?: LogRepositoryPort,
    private postMortemTradeUseCase?: PostMortemTradeUseCase,
    private preOrderAiFilterUseCase?: PreOrderAiFilterUseCase
  ) {}

  async execute(currentTime = new Date(), forceRun = false): Promise<IntradayCycleResult> {
    const startTime = Date.now();
    const marketStatus = MarketHoursService.getMarketStatus(currentTime);
    
    // Synchronisation en direct du cash réel avec le courtier si disponible
    let portfolioCash = await this.positionRepo.getPortfolioCash();
    if (this.executionBroker.getLiveCash) {
      try {
        const live = await this.executionBroker.getLiveCash();
        portfolioCash = {
          availableCash: live.availableCash,
          totalCapital: live.totalCapital,
          investedCash: parseFloat(Math.max(0, live.totalCapital - live.availableCash).toFixed(2))
        };
      } catch {}
    }
    const openPositions = await this.positionRepo.findOpenPositions();

    const localTimeStr = currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`\n[Cycle 1-Min] ⏱️ Tick Cron : ${localTimeStr} (Paris) | ${marketStatus.estTimeString} (New York EST) | Statut: ${marketStatus.reason}`);

    // Contrôle de marché : si fermé et pas de forceRun, sortie immédiate
    if (!marketStatus.isOpen && !forceRun) {
      console.log(`[Cycle 1-Min] ⏸️ Marché US fermé (${marketStatus.reason}). Skip du cycle sans requête API.`);
      
      if (this.logRepo) {
        await this.logRepo.save({
          timestamp: currentTime,
          cycleType: '1M_CYCLE',
          marketStatus: marketStatus.reason,
          scannedCount: 0,
          decision: 'SKIP_MARKET_CLOSED',
          durationMs: Date.now() - startTime
        });
      }

      return {
        timestamp: currentTime,
        marketOpen: false,
        estTime: marketStatus.estTimeString,
        isSquareOffTriggered: false,
        openPositionsCount: openPositions.length,
        openPositions,
        scannedHotListCount: 0,
        scores: [],
        closedPositions: [],
        portfolioCash,
        message: `Marché US fermé (${marketStatus.reason}). Prochaine séance à 09h30 EST (15h30 Paris).`
      };
    }

    // Synchronisation du cash réel depuis Trading 212 (avec conversion de devise en USD)
    if (typeof (this.executionBroker as any).getT212CashInUSD === 'function') {
      try {
        const t212 = await (this.executionBroker as any).getT212CashInUSD();
        if (t212 && t212.availableCashUSD > 0) {
          await this.positionRepo.updatePortfolioCash(t212.availableCashUSD);
        }
      } catch {}
    }

    // 1. Récupération de la largeur de marché ($TICK, $ADD, $TRIN, SPY)
    const breadth = await this.marketData.getMarketBreadth();

    let closedPositions: Position[] = [];

    // -------------------------------------------------------------------------
    // A. Étape Square-Off automatique (si >= 15h45 EST)
    // -------------------------------------------------------------------------
    if (marketStatus.isPastSquareOff && openPositions.length > 0) {
      console.log(`[Cycle 1-Min] 🚨 HEURE >= 15h45 EST (${marketStatus.estTimeString}) -> SQUARE-OFF STRICT ACTIVÉ !`);
      const prices = new Map<string, number>();
      for (const pos of openPositions) {
        const q = await this.marketData.getQuote(pos.symbol);
        prices.set(pos.symbol, q.price || pos.currentPrice);
      }
      closedPositions = await this.executionBroker.squareOffAllOpenPositions(prices);
      if (this.postMortemTradeUseCase && config.enableAiPostMortem) {
        for (const closed of closedPositions) {
          this.postMortemTradeUseCase.execute(closed).catch((err) => {
            console.error(`[Cycle 1-Min] ❌ Post-mortem error on square-off (${closed.symbol}) :`, err.message);
          });
        }
      }
      const portfolio = await this.positionRepo.getPortfolioCash();

      return {
        timestamp: currentTime,
        marketOpen: true,
        estTime: marketStatus.estTimeString,
        isSquareOffTriggered: true,
        marketBreadth: breadth,
        openPositionsCount: 0,
        openPositions: [],
        scannedHotListCount: 0,
        scores: [],
        closedPositions,
        portfolioCash: portfolio,
        message: `Square-off effectué avec succès (${closedPositions.length} positions liquidées).`
      };
    }

    // -------------------------------------------------------------------------
    // B. Étape Gestion des Positions Ouvertes (Update SL/TP & Invalidation)
    // -------------------------------------------------------------------------
    if (openPositions.length > 0) {
      console.log(`\n[Cycle 1-Min] 👁️ Surveillance active de ${openPositions.length} position(s) ouverte(s) :`);
    }

    for (const pos of openPositions) {
      // Détermination dynamique de l'échange de cotation
      const exchange = pos.exchange || (await this.assetRepo.findBySymbol(pos.symbol))?.exchange || 'NASDAQ';

      // Pour la surveillance temps réel des prix d'exécution
      const candles = await this.marketData.getCandles(exchange, pos.symbol, '1', 30);
      if (candles.length === 0) continue;

      const lastBar = candles[candles.length - 1];
      const curPrice = lastBar.close;
      pos.currentPrice = curPrice;

      let pnlLatent = 0;
      if (pos.side === 'LONG') {
        pnlLatent = (curPrice - pos.entryPrice) * pos.qty;
      } else {
        pnlLatent = (pos.entryPrice - curPrice) * pos.qty;
      }
      const pnlLatentPercent = pos.allocatedCash > 0 ? (pnlLatent / pos.allocatedCash) * 100 : 0;

      console.log(
        `  🔎 [${pos.symbol} ${pos.side}] Entrée: ${pos.entryPrice.toFixed(2)}$ | Cours: ${curPrice.toFixed(2)}$ | P&L: ${pnlLatent >= 0 ? '+' : ''}${pnlLatent.toFixed(2)}$ (${pnlLatentPercent >= 0 ? '+' : ''}${pnlLatentPercent.toFixed(2)}%) | SL: ${pos.stopLoss.toFixed(2)}$ | TP1: ${pos.takeProfit1.toFixed(2)}$`
      );

      // 1. Vérification Stop-Loss
      if (
        (pos.side === 'LONG' && curPrice <= pos.stopLoss) ||
        (pos.side === 'SHORT' && curPrice >= pos.stopLoss)
      ) {
        console.log(`[Cycle 1-Min] 🛑 Stop-Loss touché sur ${pos.symbol} à ${curPrice}$ (SL: ${pos.stopLoss}$)`);
        const closed = await this.executionBroker.closePosition(pos.id!, curPrice, 'STOP_LOSS');
        closedPositions.push(closed);
        continue;
      }

      // 2. Vérification & Exécution du Take-Profit 2 (Extension Max / Runners)
      if (
        pos.takeProfit2 &&
        ((pos.side === 'LONG' && curPrice >= pos.takeProfit2) ||
          (pos.side === 'SHORT' && curPrice <= pos.takeProfit2))
      ) {
        console.log(`[Cycle 1-Min] 🚀 Take-Profit 2 (Extension Max) atteint sur ${pos.symbol} à ${curPrice}$ (TP2: ${pos.takeProfit2}$)`);
        const closed = await this.executionBroker.closePosition(pos.id!, curPrice, 'TP2');
        closedPositions.push(closed);
        continue;
      }

      // 3. Vérification & Exécution du Take-Profit 1 (Vente Partielle 50% + Breakeven selon John Carter) :
      const candles5m = await this.marketData.getCandles(exchange, pos.symbol, '5', 30);
      
      if (
        !pos.tp1Executed &&
        ((pos.side === 'LONG' && curPrice >= pos.takeProfit1) ||
          (pos.side === 'SHORT' && curPrice <= pos.takeProfit1))
      ) {
        console.log(`[Cycle 1-Min] 🎯 Take-Profit 1 atteint sur ${pos.symbol} à ${curPrice}$ (TP1: ${pos.takeProfit1}$)`);
        
        const closeQty = Math.floor(pos.qty / 2);
        if (closeQty > 0 && typeof this.executionBroker.partialClosePosition === 'function') {
          console.log(`[Cycle 1-Min] 💰 Exécution Vente Partielle 50% (${closeQty}/${pos.qty} titres) sur ${pos.symbol}...`);
          const updatedPos = await this.executionBroker.partialClosePosition(pos.id!, closeQty, curPrice, 'TP1_PARTIAL');
          pos.qty = updatedPos.qty;
          pos.allocatedCash = updatedPos.allocatedCash;
          pos.tp1Executed = true;
          pos.stopLoss = updatedPos.stopLoss;
        } else {
          pos.tp1Executed = true;
          pos.stopLoss = pos.entryPrice;
          await this.positionRepo.update(pos);
          console.log(`[Trailing Stop] 🛡️ Stop-Loss remonté à BREAKEVEN (${pos.entryPrice}$) sur ${pos.symbol} [Trade Sécurisé]`);
        }
      }

      // Règle Carter 2 : Trailing Stop Dynamique Assoupli (EMA 21 5m + Marge anti-mèche 0.6 ATR)
      // Permet aux trades gagnants (runners) de respirer lors des consolidations saines
      if (candles5m.length >= 21) {
        const closes5m = candles5m.map((c) => c.close);
        const highs5m = candles5m.map((c) => c.high);
        const lows5m = candles5m.map((c) => c.low);
        const atrs5m = this.indicatorsService.calculateATR(highs5m, lows5m, closes5m, 14);
        const currentAtr = atrs5m[atrs5m.length - 1] || (curPrice * 0.005);

        const ema8 = this.indicatorsService.calculateEMA(closes5m, 8);
        const ema21 = this.indicatorsService.calculateEMA(closes5m, 21);
        const lastEma8 = ema8[ema8.length - 1];
        const lastEma21 = ema21[ema21.length - 1];

        if (pos.side === 'LONG') {
          // Creux des 5 dernières bougies 5m
          const recentLow5 = Math.min(...lows5m.slice(-5));
          
          // Référence : EMA 21 (support majeur de tendance chez Carter) ou creux swing des 5 dernières bougies
          // Si le cours est en extension parabolique (> +3 ATR au-dessus de l'entrée), on peut resserrer sur l'EMA 8
          const isParabolic = curPrice >= pos.entryPrice + 3.0 * currentAtr;
          const referenceEma = isParabolic ? lastEma8 : lastEma21;
          const atrBuffer = isParabolic ? 0.4 * currentAtr : 0.6 * currentAtr;
          
          let trailingTarget = parseFloat((Math.min(referenceEma, recentLow5) - atrBuffer).toFixed(2));

          // Si TP1 a déjà été atteint, le Trailing Stop est garanti au minimum au prix d'entrée (Breakeven)
          if (pos.tp1Executed) {
            trailingTarget = Math.max(trailingTarget, pos.entryPrice);
          }

          // On ne remonte le stop que si le cours a fait un progrès significatif (+0.8 ATR au-dessus de l'entrée)
          const isSignificantlyInProfit = curPrice >= (pos.entryPrice + 0.8 * currentAtr);
          if (trailingTarget > pos.stopLoss && isSignificantlyInProfit) {
            console.log(`[Trailing Stop] 📈 Trailing Stop Long élargi : ${pos.stopLoss}$ -> ${trailingTarget}$ (Cours: ${curPrice.toFixed(2)}$ | EMA21: ${lastEma21.toFixed(2)}$ | TP1 touché: ${pos.tp1Executed ? 'OUI' : 'NON'})`);
            pos.stopLoss = trailingTarget;
            await this.positionRepo.update(pos);
          }
        } else if (pos.side === 'SHORT') {
          const recentHigh5 = Math.max(...highs5m.slice(-5));
          const isParabolic = curPrice <= pos.entryPrice - 3.0 * currentAtr;
          const referenceEma = isParabolic ? lastEma8 : lastEma21;
          const atrBuffer = isParabolic ? 0.4 * currentAtr : 0.6 * currentAtr;

          let trailingTarget = parseFloat((Math.max(referenceEma, recentHigh5) + atrBuffer).toFixed(2));

          if (pos.tp1Executed) {
            trailingTarget = Math.min(trailingTarget, pos.entryPrice);
          }

          const isSignificantlyInProfit = curPrice <= (pos.entryPrice - 0.8 * currentAtr);
          if (trailingTarget < pos.stopLoss && isSignificantlyInProfit) {
            console.log(`[Trailing Stop] 📉 Trailing Stop Short élargi : ${pos.stopLoss}$ -> ${trailingTarget}$ (Cours: ${curPrice.toFixed(2)}$ | EMA21: ${lastEma21.toFixed(2)}$ | TP1 touché: ${pos.tp1Executed ? 'OUI' : 'NON'})`);
            pos.stopLoss = trailingTarget;
            await this.positionRepo.update(pos);
          }
        }
      }

      // 4. Sortie Anticipée sur Affaiblissement du Momentum TTM (Chapitre 11 John Carter)
      // Carter sort dès que l'histogramme de momentum montre son premier affaiblissement (CYAN -> BLUE pour Long)
      if (candles5m.length >= 21) {
        const sq5mCurrent = this.indicatorsService.evaluateTTMSqueeze(candles5m, 20);

        const isLongWeakened =
          pos.side === 'LONG' &&
          (sq5mCurrent.histColor === 'BLUE' || sq5mCurrent.histColor === 'RED' || (sq5mCurrent.momentum <= 0 && sq5mCurrent.slope === 'FALLING'));

        const isShortWeakened =
          pos.side === 'SHORT' &&
          (sq5mCurrent.histColor === 'YELLOW' || sq5mCurrent.histColor === 'CYAN' || (sq5mCurrent.momentum >= 0 && sq5mCurrent.slope === 'RISING'));

        const isWeakened = isLongWeakened || isShortWeakened;

        if (isWeakened) {
          console.log(`[Cycle 1-Min] 🔄 Ralentissement du Momentum Squeeze détecté pour ${pos.symbol} (Couleur: ${sq5mCurrent.histColor}, Momentum: ${sq5mCurrent.momentum.toFixed(4)}) -> Sortie au Marché John Carter.`);
          const closed = await this.executionBroker.closePosition(pos.id!, curPrice, 'MOMENTUM_INVALIDATION');
          closedPositions.push(closed);
          if (this.postMortemTradeUseCase && config.enableAiPostMortem) {
            this.postMortemTradeUseCase.execute(closed).catch((err) => {
              console.error(`[Cycle 1-Min] ❌ Post-mortem error on momentum exit (${closed.symbol}) :`, err.message);
            });
          }
          continue;
        }
      }

      await this.positionRepo.update(pos);
    }

    // -------------------------------------------------------------------------
    // C. Étape Détection des Signaux & Prise de Position (Entonnoir Dynamique sur 1000 Actifs)
    // -------------------------------------------------------------------------
    const activeOpenPositions = await this.positionRepo.findOpenPositions();
    let portfolio = await this.positionRepo.getPortfolioCash();
    let executedTrade: Position | undefined;
    const scores: CarterScore[] = [];

    // Règle d'Ouverture : Filtrage du bruit de 15h30-16h00 (09h30-10h00 EST)
    if (!marketStatus.canOpenNewPositions) {
      const waitMessage = marketStatus.isOpeningNoise
        ? `[Cycle 1-Min] ⏳ Phase d'Ouverture (09h30-10h00 EST / 15h30-16h00 Paris) : Filtrage anti-bruit actif (attente de l'Initial Balance à 16h00). Aucune entrée autorisée.`
        : `[Cycle 1-Min] ⏸️ Fenêtre d'entrée fermée (${marketStatus.reason}).`;
      console.log(waitMessage);
      return this.buildCycleResult(currentTime, marketStatus, breadth, activeOpenPositions, 0, scores, undefined, closedPositions, portfolio, waitMessage);
    }

    const totalCapital = portfolio.totalCapital || (portfolio.availableCash + (portfolio.investedCash || 0));
    const investedCashPercent = totalCapital > 0 ? ((portfolio.investedCash || 0) / totalCapital) * 100 : 0;
    const availableCashPercent = totalCapital > 0 ? (portfolio.availableCash / totalCapital) * 100 : 100;

    // Règle de Sécurité : Arrêter immédiatement les calculs de scan si au moins 80% du cash est investi (ou cash dispo <= 20%)
    if (investedCashPercent >= 80 || availableCashPercent <= 20) {
      console.log(`[Cycle 1-Min] ⏸️ Scan suspendu : ${investedCashPercent.toFixed(1)}% du capital investi (Seuil max 80% atteint | Cash dispo: ${portfolio.availableCash.toFixed(2)}$ / ${totalCapital.toFixed(2)}$).`);
      return this.buildCycleResult(currentTime, marketStatus, breadth, activeOpenPositions, 0, scores, undefined, closedPositions, portfolio, `Capital investi maximal atteint (${investedCashPercent.toFixed(1)}% >= 80%)`);
    }

    // 1. Chargement de l'univers des actifs ayant un ticker Trading 212 valide
    const rawUniverseAssets = await this.assetRepo.findAll(true);
    const allUniverseAssets = rawUniverseAssets.filter((a) => a.t212Ticker && a.t212Ticker.trim().length > 0);
    const timeframe = config.intradayResolution || '5';

    console.log(`[Cycle 1-Min] 🏛️ Scan de l'univers S&P 500 (${allUniverseAssets.length} leaders institutionnels). Positions actives: ${activeOpenPositions.length} | Cash dispo: ${portfolio.availableCash.toFixed(2)}$ (${availableCashPercent.toFixed(1)}%)`);

    // ÉTAGE 1 : Pré-filtrage ultra-rapide par Batch Quotes HTTP (1 seule requête par lot de 50)
    // Objectif : Isoler instantanément les actions en mouvement significatif (Gap/Volatilité/Volume)
    const symbolsToPreScan = allUniverseAssets
      .filter((a) => !activeOpenPositions.some((p) => p.symbol === a.symbol))
      .map((a) => a.symbol);

    const quotesMap = await this.marketData.getQuotesBatch(symbolsToPreScan);

    // Calcul du score de dynamisme instantané
    const dynamicMovers: { asset: typeof allUniverseAssets[0]; dynamicScore: number; price: number }[] = [];
    for (const asset of allUniverseAssets) {
      if (activeOpenPositions.some((p) => p.symbol === asset.symbol)) continue;
      const q = quotesMap.get(asset.symbol);
      if (!q || !q.price || q.price < 5.0) continue;

      const gap = Math.abs(q.gapPercent || 0);
      const volume = q.volume || 0;
      const avgVol = q.avgVolume50d || 1000000;
      const volRatio = volume / (avgVol / 78); // Ratio de volume rapporté à une tranche de 5 min

      // Score de dynamisme : Mouvement du prix + Poussée de volume
      const dynamicScore = gap * 5 + volRatio * 2;
      dynamicMovers.push({ asset, dynamicScore, price: q.price });
    }

    // Tri des meilleurs candidats de la minute (Élargissement au Top 100)
    dynamicMovers.sort((a, b) => b.dynamicScore - a.dynamicScore);
    const topCandidatesToDeepScan = dynamicMovers.slice(0, 100).map((m) => m.asset);

    console.log(`[Cycle 1-Min] 🎯 Étage 1 validé : ${topCandidatesToDeepScan.length} actions dynamiques qualifiées pour le calcul approfondi TTM Squeeze 5m/60m.`);

    // ÉTAGE 2 : Calcul complet des indicateurs John Carter (5m, 60m, Pivots, Régression Linéaire)
    const chunkSize = 15;
    for (let i = 0; i < topCandidatesToDeepScan.length; i += chunkSize) {
      const chunk = topCandidatesToDeepScan.slice(i, i + chunkSize);
      const promises = chunk.map(async (asset) => {
        // Bougies Intraday (5m par défaut) : 60 barres pour couvrir TTM Waves A, B, C (34 barres) + Squeeze (20 barres)
        const candlesIntra = await this.marketData.getCandles(asset.exchange, asset.symbol, timeframe, 60);
        if (candlesIntra.length < 20) return null;

        // Vérification de la fraîcheur des données (aujourd'hui)
        const lastBar = candlesIntra[candlesIntra.length - 1];
        const barTime = new Date(lastBar.time).getTime();
        if (marketStatus.isRegularTradingHours && Date.now() - barTime > 2 * 60 * 60 * 1000) {
          return null;
        }

        // Bougies Anchor (60m & Daily pour les pivots et TTM Waves macro) : 50 barres 60m
        const [candles60m, candlesDaily] = await Promise.all([
          this.marketData.getCandles(asset.exchange, asset.symbol, '60', 50),
          this.marketData.getCandles(asset.exchange, asset.symbol, 'D', 5)
        ]);

        return this.indicatorsService.calculateCarterScore(
          asset.symbol,
          candlesIntra,
          candles60m.length >= 20 ? candles60m : null,
          candlesDaily.length >= 2 ? candlesDaily : null,
          breadth,
          timeframe
        );
      });

      const chunkResults = await Promise.all(promises);
      for (const res of chunkResults) {
        if (res) {
          scores.push(res);
          // Mettre à jour le dernier prix connu de l'actif en base SQLite
          this.assetRepo.updateHotListStatus(res.symbol, true, undefined, res.currentPrice).catch(() => {});
        }
      }
    }

    // Filtrage STRICT : LONG ONLY & Qualification pure par portes bloquantes (isValid = true)
    const longCandidates = scores.filter((s) => s.direction === 'LONG');
    const qualifiedCandidates = longCandidates.filter((s) => s.isValid);

    // Affichage des diagnostics des meilleurs candidats analysés
    if (longCandidates.length > 0) {
      console.log(`\n[Cycle 1-Min] 📊 Analyse des signaux John Carter (Top ${Math.min(3, longCandidates.length)}) :`);
      longCandidates.slice(0, 3).forEach((s, idx) => {
        const statusIcon = s.isValid ? '⭐ [QUALIFIÉ]' : `❌ [REJETÉ: ${s.rejectionReason}]`;
        console.log(
          `  ${idx + 1}. [${s.symbol}] ${statusIcon} | Squeeze: ${s.squeezeFired ? 'FIRED' : s.inSqueeze ? 'COMPRESSION' : 'HORS SQUEEZE'} (Mom: ${s.momentum.toFixed(4)}) | Anchor 60m: ${s.criteria?.anchorTrendValid ? 'HAUSSIER' : 'NEUTRE/BAISSIER'} (Mom60m: ${s.momentum60m?.toFixed(4)}) | RVOL: ${s.rvol.toFixed(2)} | R/R: ${s.criteria?.riskRewardRatio || 0}R`
        );
      });
    }

    const bestCandidate = qualifiedCandidates[0];
    const hasEnoughCash = portfolio.availableCash >= 50;

    if (!bestCandidate) {
      console.log(`[Cycle 1-Min] ⏸️ Pas de trade : Aucun actif ne valide simultanément les 4 critères obligatoires John Carter (Marché + Anchor 60m + Squeeze 5m + RVOL >= 1.2).`);
    } else if (!hasEnoughCash) {
      console.log(`[Cycle 1-Min] ⏸️ Pas de trade sur ${bestCandidate.symbol} : Cash disponible insuffisant (${portfolio.availableCash.toFixed(2)}$ < 50$).`);
    } else {
      console.log(`\n[Cycle 1-Min] ⭐ SIGNAL LONG JOHN CARTER QUALIFIÉ SUR ${bestCandidate.symbol} ! [TOUS CRITÈRES VALIDES]`);
      console.log(`  - Déclencheur : Squeeze ${bestCandidate.squeezeFired ? 'FIRED' : 'COMPRESSION DIR.'} | Momentum 5m=${bestCandidate.momentum.toFixed(4)} (${bestCandidate.momentumHistColor}) | Anchor 60m haussier | RVOL=${bestCandidate.rvol}`);

      // -----------------------------------------------------------------------
      // Formule de Position Sizing STRICTE selon John Carter :
      // N_risque = floor((CapitalTotal * RiskPct) / |PrixEntree - PrixStop|)
      // N_effectif = min(N_risque, N_max_user, floor(CashDisponible / PrixEntree))
      // -----------------------------------------------------------------------
      const entryPrice = bestCandidate.currentPrice;
      const stopLossPrice = bestCandidate.stopLossLevel;
      const stopDistance = Math.abs(entryPrice - stopLossPrice);

      if (stopDistance > 0 && entryPrice > 0) {
        // -----------------------------------------------------------------------
        // Plafonnement Double Sécurité :
        // 1. Risque max dollar = 1% du capital total (John Carter)
        // 2. Plafond d'engagement en capital = Max 40% du capital total par trade
        // -----------------------------------------------------------------------
        const riskDollar = totalCapital * config.riskPerTradePercent; // 1% de perte max tolérée
        const nRisk = Math.floor(riskDollar / stopDistance);

        // Plafond d'allocation max : 40% du capital total ou cash disponible
        // Marge de sécurité de 30% (facteur 0.70) sur le cash disponible pour couvrir la réserve de volatilité étendue (20-25%) exigée par Trading 212
        const safeAvailableCash = portfolio.availableCash * 0.70;
        const maxCapitalForTrade = Math.min(totalCapital * 0.40, safeAvailableCash, config.maxPositionCapital);
        const nMaxCapital = Math.floor(maxCapitalForTrade / entryPrice);

        const qty = Math.min(nRisk, config.maxPositionUnits, nMaxCapital);
        const allocatedCash = parseFloat((qty * entryPrice).toFixed(2));
        const actualRiskDollar = parseFloat((qty * stopDistance).toFixed(2));
        const actualRiskPercent = totalCapital > 0 ? ((actualRiskDollar / totalCapital) * 100).toFixed(2) : '0';

        console.log(`  - Position Sizing : Capital Total=${totalCapital.toFixed(2)}$ | Risque 1% cible=${riskDollar.toFixed(2)}$ | Distance Stop=${stopDistance.toFixed(2)}$ (SL: ${stopLossPrice}$)`);
        console.log(`  - Plafonds : N_risque=${nRisk} (${(nRisk * entryPrice).toFixed(2)}$) | N_max40%=${nMaxCapital} (Cash dispo sécurisé: ${safeAvailableCash.toFixed(2)}$) -> Quantité retenue: ${qty} titres @ ${entryPrice.toFixed(2)}$ (Engagé: ${allocatedCash}$)`);
        console.log(`  - Risque réel engagé : ${actualRiskDollar}$ (${actualRiskPercent}% du capital total)`);

        if (qty > 0 && allocatedCash <= safeAvailableCash) {
          // Étape 2 (Filtre Pré-Ordre IA - AI_FEEDBACK_LOOP.md)
          if (this.preOrderAiFilterUseCase) {
            const aiDecision = await this.preOrderAiFilterUseCase.evaluate(bestCandidate, marketStatus.estTimeString);
            if (!aiDecision.approve) {
              console.warn(`[Cycle 1-Min] 🛑 ORDRE ANNULÉ par le Filtre IA Pré-Ordre sur ${bestCandidate.symbol} (Raison: ${aiDecision.reason})`);
              return this.buildCycleResult(
                currentTime,
                marketStatus,
                breadth,
                activeOpenPositions,
                allUniverseAssets.length,
                scores,
                undefined,
                closedPositions,
                portfolio,
                `Ordre rejeté par le Filtre IA Pré-Ordre sur ${bestCandidate.symbol} (${aiDecision.reason})`,
                bestCandidate,
                startTime
              );
            }
          }

          const matchingAsset = await this.assetRepo.findBySymbol(bestCandidate.symbol);
          const exchange = matchingAsset?.exchange || 'NASDAQ';

          try {
            executedTrade = await this.executionBroker.openBracketPosition(
              bestCandidate.symbol,
              exchange,
              bestCandidate.direction as 'LONG' | 'SHORT',
              entryPrice,
              qty,
              allocatedCash,
              bestCandidate.stopLossLevel,
              bestCandidate.takeProfit1Level,
              bestCandidate.scoreTotal,
              bestCandidate.takeProfit2Level
            );
          } catch (err: any) {
            console.error(`[Execution Broker] ❌ Ordre Achat rejeté par le courtier pour ${bestCandidate.symbol} : ${err.message}`);
            executedTrade = undefined;
          }
        } else {
          console.log(`[Risk Management] ⚠️ Ordre annulé : Quantité calculée égale à 0 (Prix unitaire trop élevé pour le capital alloué).`);
        }
      }
    }

    portfolio = await this.positionRepo.getPortfolioCash();
    const finalOpenPositions: Position[] = await this.positionRepo.findOpenPositions();
    const message = executedTrade
      ? `Nouveau trade exécuté sur ${executedTrade.symbol} (Score: ${executedTrade.scoreAtEntry})`
      : `Cycle complété sans nouveau trade. (Positions actives: ${finalOpenPositions.length} | Cash dispo: ${portfolio.availableCash.toFixed(2)}$)`;

    return this.buildCycleResult(
      currentTime,
      marketStatus,
      breadth,
      finalOpenPositions,
      allUniverseAssets.length,
      scores,
      executedTrade,
      closedPositions,
      portfolio,
      message,
      bestCandidate,
      startTime
    );
  }

  private async buildCycleResult(
    currentTime: Date,
    marketStatus: any,
    breadth: any,
    openPositions: Position[],
    scannedCount: number,
    scores: CarterScore[],
    executedTrade: Position | undefined,
    closedPositions: Position[],
    portfolio: any,
    message: string,
    bestCandidate?: CarterScore,
    startTime = Date.now()
  ): Promise<IntradayCycleResult> {
    const durationMs = Date.now() - startTime;

    if (this.logRepo) {
      await this.logRepo.save({
        timestamp: currentTime,
        cycleType: '1M_CYCLE',
        marketStatus: marketStatus.reason,
        nyseTick: breadth.nyseTick,
        nyseAdd: breadth.nyseAdd,
        trin: breadth.trin,
        spyPrice: breadth.spyPrice,
        scannedCount,
        topCandidate: bestCandidate ? bestCandidate.symbol : undefined,
        topScore: bestCandidate ? bestCandidate.scoreTotal : undefined,
        decision: executedTrade ? `ENTER_${bestCandidate?.direction}_${bestCandidate?.symbol}` : 'NO_TRADE',
        tradeExecuted: executedTrade ? `${executedTrade.symbol} ${executedTrade.side} ${executedTrade.qty} @ ${executedTrade.entryPrice}` : undefined,
        durationMs,
        detailsJson: JSON.stringify({
          scores: scores.slice(0, 5),
          openPositions: openPositions.map((p) => ({ symbol: p.symbol, pnl: p.pnl, pnlPercent: p.pnlPercent }))
        })
      });
    }

    return {
      timestamp: currentTime,
      marketOpen: true,
      estTime: marketStatus.estTimeString,
      isSquareOffTriggered: false,
      marketBreadth: breadth,
      openPositionsCount: openPositions.length,
      openPositions,
      scannedHotListCount: scannedCount,
      scores: scores.slice(0, 10),
      executedTrade,
      closedPositions,
      portfolioCash: portfolio,
      message
    };
  }
}
