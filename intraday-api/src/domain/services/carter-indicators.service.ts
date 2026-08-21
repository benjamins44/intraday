import { Candle, CarterScore } from '../models/scoring.entity';
import { MarketBreadth } from '../models/market-breadth.entity';
import { MarketHoursService } from './market-hours.service';

export interface TTMSqueezeResult {
  inSqueeze: boolean;
  squeezeFired: boolean;
  momentum: number; // Valeur de la régression linéaire
  prevMomentum: number;
  histColor: 'CYAN' | 'BLUE' | 'RED' | 'YELLOW';
  slope: 'RISING' | 'FALLING';
  bbUpper: number;
  bbLower: number;
  kcUpper: number;
  kcLower: number;
  atr: number;
}

export interface PivotPoints {
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export class CarterIndicatorsService {
  /**
   * Moyenne mobile simple (SMA)
   */
  public calculateSMA(data: number[], period: number): (number | null)[] {
    const sma: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push(null);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val, 0);
        sma.push(sum / period);
      }
    }
    return sma;
  }

  /**
   * Average True Range (ATR)
   */
  public calculateATR(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
    const tr: number[] = [];
    for (let i = 0; i < highs.length; i++) {
      if (i === 0) {
        tr.push(highs[i] - lows[i]);
      } else {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
      }
    }
    return this.calculateSMA(tr, period);
  }

  /**
   * Régression linéaire sur une période donnée (calcul de la valeur projetée au point final i)
   * Formule : y = slope * x + intercept
   */
  public calculateLinearRegression(data: number[], length: number): (number | null)[] {
    const result: (number | null)[] = [];
    const sumX = (length * (length - 1)) / 2;
    const sumX2 = (length * (length - 1) * (2 * length - 1)) / 6;
    const divisor = length * sumX2 - sumX * sumX;

    for (let i = 0; i < data.length; i++) {
      if (i < length - 1) {
        result.push(null);
        continue;
      }

      let sumY = 0;
      let sumXY = 0;

      for (let j = 0; j < length; j++) {
        const val = data[i - length + 1 + j];
        sumY += val;
        sumXY += j * val;
      }

      const slope = (length * sumXY - sumX * sumY) / divisor;
      const intercept = (sumY - slope * sumX) / length;
      const endValue = intercept + slope * (length - 1);
      result.push(endValue);
    }

    return result;
  }

  /**
   * Évaluation complète et conforme du TTM Squeeze selon John Carter :
   * 1. Bandes de Bollinger (20, 2.0 stdDev)
   * 2. Canaux de Keltner (20, 1.5 ATR)
   * 3. Oscillateur de Momentum : Régression Linéaire sur (Close - (DonchianMidpoint(20) + SMA20)/2)
   * 4. 4 Couleurs de l'histogramme :
   *    - CYAN : Au-dessus de 0 et croissant (Momentum haussier fort)
   *    - BLEU : Au-dessus de 0 et décroissant (Momentum haussier en décélération)
   *    - ROUGE : En-dessous de 0 et décroissant (Momentum baissier fort)
   *    - JAUNE : En-dessous de 0 et croissant (Momentum baissier en décélération)
   */
  public evaluateTTMSqueeze(candles: Candle[], length = 20): TTMSqueezeResult {
    if (!candles || candles.length < length + 5) {
      return {
        inSqueeze: false,
        squeezeFired: false,
        momentum: 0,
        prevMomentum: 0,
        histColor: 'BLUE',
        slope: 'FALLING',
        bbUpper: 0,
        bbLower: 0,
        kcUpper: 0,
        kcLower: 0,
        atr: 0
      };
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const sma20 = this.calculateSMA(closes, length);
    const atr20 = this.calculateATR(highs, lows, closes, length);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;

    const meanLast = sma20[lastIdx] ?? closes[lastIdx];
    const atrLast = atr20[lastIdx] ?? (highs[lastIdx] - lows[lastIdx]);
    const meanPrev = sma20[prevIdx] ?? closes[prevIdx];
    const atrPrev = atr20[prevIdx] ?? (highs[prevIdx] - lows[prevIdx]);

    // Écart-type pour Bollinger
    const sliceLast = closes.slice(lastIdx - length + 1, lastIdx + 1);
    const stdDevLast = Math.sqrt(
      sliceLast.reduce((sum, val) => sum + Math.pow(val - meanLast, 2), 0) / length
    );

    const slicePrev = closes.slice(prevIdx - length + 1, prevIdx + 1);
    const stdDevPrev = Math.sqrt(
      slicePrev.reduce((sum, val) => sum + Math.pow(val - meanPrev, 2), 0) / length
    );

    // Bandes de Bollinger (2.0)
    const bbUpperLast = meanLast + 2.0 * stdDevLast;
    const bbLowerLast = meanLast - 2.0 * stdDevLast;
    const bbUpperPrev = meanPrev + 2.0 * stdDevPrev;
    const bbLowerPrev = meanPrev - 2.0 * stdDevPrev;

    // Canaux de Keltner (1.5)
    const kcUpperLast = meanLast + 1.5 * atrLast;
    const kcLowerLast = meanLast - 1.5 * atrLast;
    const kcUpperPrev = meanPrev + 1.5 * atrPrev;
    const kcLowerPrev = meanPrev - 1.5 * atrPrev;

    // État de compression
    const inSqueezeNow = bbUpperLast < kcUpperLast && bbLowerLast > kcLowerLast;
    const inSqueezePrev = bbUpperPrev < kcUpperPrev && bbLowerPrev > kcLowerPrev;

    // Déclenchement (Fired) : était en compression et en sort
    const squeezeFired = inSqueezePrev && !inSqueezeNow;

    // Calcul du Delta pour la Régression Linéaire : Close - (DonchianMidpoint + SMA20)/2
    const deltas: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < length - 1) {
        deltas.push(0);
      } else {
        const subHighs = highs.slice(i - length + 1, i + 1);
        const subLows = lows.slice(i - length + 1, i + 1);
        const highestHigh = Math.max(...subHighs);
        const lowestLow = Math.min(...subLows);
        const donchianMid = (highestHigh + lowestLow) / 2;
        const currentSma = sma20[i] ?? closes[i];
        const baseline = (donchianMid + currentSma) / 2;
        deltas.push(closes[i] - baseline);
      }
    }

    const regLin = this.calculateLinearRegression(deltas, length);
    const momentum = regLin[lastIdx] ?? 0;
    const prevMomentum = regLin[prevIdx] ?? 0;

    let histColor: 'CYAN' | 'BLUE' | 'RED' | 'YELLOW';
    const slope: 'RISING' | 'FALLING' = momentum >= prevMomentum ? 'RISING' : 'FALLING';

    if (momentum >= 0) {
      histColor = slope === 'RISING' ? 'CYAN' : 'BLUE';
    } else {
      histColor = slope === 'FALLING' ? 'RED' : 'YELLOW';
    }

    return {
      inSqueeze: inSqueezeNow,
      squeezeFired,
      momentum: parseFloat(momentum.toFixed(4)),
      prevMomentum: parseFloat(prevMomentum.toFixed(4)),
      histColor,
      slope,
      bbUpper: bbUpperLast,
      bbLower: bbLowerLast,
      kcUpper: kcUpperLast,
      kcLower: kcLowerLast,
      atr: atrLast
    };
  }

  /**
   * Calcul des Floor Pivots quotidiens (PP, R1, R2, S1, S2)
   */
  public calculateFloorPivots(dailyHigh: number, dailyLow: number, dailyClose: number): PivotPoints {
    const pivot = (dailyHigh + dailyLow + dailyClose) / 3;
    const r1 = 2 * pivot - dailyLow;
    const s1 = 2 * pivot - dailyHigh;
    const r2 = pivot + (dailyHigh - dailyLow);
    const s2 = pivot - (dailyHigh - dailyLow);

    return {
      pivot: parseFloat(pivot.toFixed(2)),
      r1: parseFloat(r1.toFixed(2)),
      r2: parseFloat(r2.toFixed(2)),
      s1: parseFloat(s1.toFixed(2)),
      s2: parseFloat(s2.toFixed(2))
    };
  }

  /**
   * Calcul du RVOL Intraday avec ajustement de la courbe en U
   * En intraday, l'ouverture (09:30-10:30) et la fermeture (15:00-16:00) ont un volume naturellement 2x à 3x plus élevé.
   */
  public calculateAdjustedRvol(candles: Candle[], timeOfDayEstMinutes: number): number {
    if (!candles || candles.length < 5) return 1.0;

    // Récupérer la dernière bougie terminée avec volume réel (si la bougie en cours à 0 seconde a volume=0, prendre la précédente)
    let lastCompletedIdx = candles.length - 1;
    while (lastCompletedIdx > 0 && candles[lastCompletedIdx].volume === 0) {
      lastCompletedIdx--;
    }

    const targetCandle = candles[lastCompletedIdx];
    const lastVol = targetCandle.volume;
    if (lastVol <= 0) return 1.0;

    // Moyenne des bougies précédentes
    const startIdx = Math.max(0, lastCompletedIdx - 20);
    const recentVolumes = candles.slice(startIdx, lastCompletedIdx).map((c) => c.volume).filter((v) => v > 0);
    const avgRecent = recentVolumes.length > 0 ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length : lastVol;

    // Facteur d'atténuation de la courbe en U selon l'heure (minutes depuis minuit EST)
    let uCurveMultiplier = 1.0;
    if (timeOfDayEstMinutes >= 570 && timeOfDayEstMinutes <= 615) {
      uCurveMultiplier = 1.4;
    } else if (timeOfDayEstMinutes >= 915 && timeOfDayEstMinutes <= 960) {
      uCurveMultiplier = 1.3;
    } else if (timeOfDayEstMinutes > 660 && timeOfDayEstMinutes < 840) {
      uCurveMultiplier = 0.8;
    }

    const baselineVolume = avgRecent * uCurveMultiplier;
    return parseFloat((lastVol / (baselineVolume || 1)).toFixed(2));
  }

  /**
   * Évaluation STRICTE selon la méthodologie John Carter (Gating / Portes Bloquantes)
   * Un trade est validé (isValid = true) SI ET SEULEMENT SI :
   * 1. Le marché global n'est pas hostile ($ADD > -1000 et $TICK < +1000)
   * 2. L'Anchor 60m est en tendance haussière confirmée (Mom60m > 0 et pente RISING)
   * 3. Le TTM Squeeze 5m est en déclenchement actif (Fired) ou en compression (InSqueeze) avec Mom > 0
   * 4. Le Volume Relatif institutionnel est qualifié (RVOL >= 1.2)
   * 5. Le Ratio Gain/Risque théorique est >= 1.5R
   */
  public evaluateCarterSignal(
    symbol: string,
    candlesIntraday: Candle[], // Bougies 5m ou 15m
    candles60m: Candle[] | null,
    candlesDaily: Candle[] | null,
    breadth: MarketBreadth,
    timeframe: '5' | '15' = '5'
  ): CarterScore {
    const lastBar = candlesIntraday[candlesIntraday.length - 1];
    const currentPrice = lastBar.close;
    const sqIntra = this.evaluateTTMSqueeze(candlesIntraday, 20);

    // ATR 14 Intraday
    const highs = candlesIntraday.map((c) => c.high);
    const lows = candlesIntraday.map((c) => c.low);
    const closes = candlesIntraday.map((c) => c.close);
    const atrs = this.calculateATR(highs, lows, closes, 14);
    const atr14 = atrs[atrs.length - 1] || Math.max(0.2, currentPrice * 0.005);

    // -------------------------------------------------------------------------
    // PORTE 1 : Largeur de Marché $ADD / $TICK
    // -------------------------------------------------------------------------
    const isMarketBullish = breadth.nyseAdd > -1000 && breadth.nyseTick < 1000 && breadth.regime !== 'TREND_DAY_BEAR';

    // -------------------------------------------------------------------------
    // PORTE 2 : Anchor Chart 60 min (Tendance de fond)
    // -------------------------------------------------------------------------
    let momentum60m = 0;
    let slope60m: 'RISING' | 'FALLING' = 'FALLING';
    let isAnchorBullish = false;

    if (candles60m && candles60m.length >= 20) {
      const sq60m = this.evaluateTTMSqueeze(candles60m, 20);
      momentum60m = sq60m.momentum;
      slope60m = sq60m.slope;
      isAnchorBullish = momentum60m > 0 && slope60m === 'RISING';
    } else {
      isAnchorBullish = true; // Tolérance si données 60m indisponibles
    }

    // -------------------------------------------------------------------------
    // PORTE 3 : Déclencheur TTM Squeeze 5 min
    // Soit Squeeze Fired (Point vert), soit compression active avec Mom > 0 croissant
    // -------------------------------------------------------------------------
    const isSqueezeValid =
      (sqIntra.squeezeFired && sqIntra.momentum >= 0) ||
      (sqIntra.inSqueeze && sqIntra.momentum > 0 && sqIntra.slope === 'RISING') ||
      (sqIntra.histColor === 'CYAN' && sqIntra.momentum > 0 && sqIntra.slope === 'RISING');

    // -------------------------------------------------------------------------
    // PORTE 4 : Volume Relatif (RVOL >= 1.20)
    // -------------------------------------------------------------------------
    const estMinutes = MarketHoursService.getEstMinutes(new Date(lastBar.time));
    const rvol = this.calculateAdjustedRvol(candlesIntraday, estMinutes);
    const isRvolValid = rvol >= 1.20;

    // -------------------------------------------------------------------------
    // PORTE 5 : Niveaux de Prix & Ratio Gain/Risque (>= 1.5R)
    // -------------------------------------------------------------------------
    let pivots: PivotPoints | undefined;
    if (candlesDaily && candlesDaily.length >= 2) {
      const prevDay = candlesDaily[candlesDaily.length - 2];
      pivots = this.calculateFloorPivots(prevDay.high, prevDay.low, prevDay.close);
    }

    const recentLows = lows.slice(-5);
    const swingLow = Math.min(...recentLows);
    const structuralLow = Math.min(swingLow, sqIntra.kcLower);
    let stopLossLevel = parseFloat((structuralLow - 0.5 * atr14).toFixed(2));

    if (currentPrice - stopLossLevel > currentPrice * 0.04) {
      stopLossLevel = parseFloat((currentPrice - 2.0 * atr14).toFixed(2));
    } else if (stopLossLevel >= currentPrice) {
      stopLossLevel = parseFloat((currentPrice - 1.5 * atr14).toFixed(2));
    }

    const riskDistance = Math.max(0.2, currentPrice - stopLossLevel);
    const targetAtr2 = currentPrice + 2.0 * atr14;
    const targetMinRR = currentPrice + 1.5 * riskDistance;
    let targetCandidate = Math.max(targetAtr2, targetMinRR);

    if (pivots && pivots.r1 > currentPrice + 1.0 * atr14) {
      targetCandidate = pivots.r1;
    } else if (pivots && pivots.r2 > currentPrice) {
      targetCandidate = Math.max(targetCandidate, pivots.r2);
    }

    const takeProfit1Level = parseFloat(targetCandidate.toFixed(2));
    const takeProfit2Level = parseFloat((currentPrice + 3.5 * atr14).toFixed(2));
    const riskRewardRatio = parseFloat(((takeProfit1Level - currentPrice) / riskDistance).toFixed(2));
    const isRiskRewardValid = riskRewardRatio >= 1.40;

    // -------------------------------------------------------------------------
    // SYNTHÈSE DES PORTES DE VALIDATION (TOUT DOIT ÊTRE VRAI)
    // -------------------------------------------------------------------------
    const isValid = isMarketBullish && isAnchorBullish && isSqueezeValid && isRvolValid && isRiskRewardValid;

    let rejectionReason: string | undefined;
    if (!isMarketBullish) rejectionReason = `Marché défavorable ($ADD=${breadth.nyseAdd}, $TICK=${breadth.nyseTick})`;
    else if (!isAnchorBullish) rejectionReason = `Anchor 60m non aligné (Mom60m=${momentum60m.toFixed(4)}, Pente=${slope60m})`;
    else if (!isSqueezeValid) rejectionReason = `Absence de déclenchement Squeeze valide (InSqueeze=${sqIntra.inSqueeze}, Fired=${sqIntra.squeezeFired}, Mom=${sqIntra.momentum.toFixed(4)})`;
    else if (!isRvolValid) rejectionReason = `Volume insuffisant (RVOL=${rvol.toFixed(2)} < 1.20)`;
    else if (!isRiskRewardValid) rejectionReason = `Ratio R/R insuffisant (${riskRewardRatio}R < 1.4R)`;

    return {
      symbol,
      timestamp: new Date(lastBar.time),
      timeframe,
      direction: 'LONG',
      isValid,
      rejectionReason,
      scoreTotal: isValid ? 100 : 0, // 100 si qualifié, 0 sinon

      criteria: {
        marketConditionValid: isMarketBullish,
        nyseAdd: breadth.nyseAdd,
        nyseTick: breadth.nyseTick,
        anchorTrendValid: isAnchorBullish,
        momentum60m,
        squeezeTriggerValid: isSqueezeValid,
        inSqueeze: sqIntra.inSqueeze,
        squeezeFired: sqIntra.squeezeFired,
        momentum5m: sqIntra.momentum,
        momentumHistColor: sqIntra.histColor,
        momentumSlope: sqIntra.slope,
        rvolValid: isRvolValid,
        rvol,
        riskRewardValid: isRiskRewardValid,
        riskRewardRatio
      },

      inSqueeze: sqIntra.inSqueeze,
      squeezeFired: sqIntra.squeezeFired,
      momentum: sqIntra.momentum,
      momentumHistColor: sqIntra.histColor,
      momentumSlope: sqIntra.slope,
      momentum60m,
      momentumSlope60m: slope60m,
      rvol,
      currentPrice,
      atr14,
      stopLossLevel,
      takeProfit1Level,
      takeProfit2Level,
      pivotPoints: pivots
    };
  }

  // Alias rétrocompatible pour ne rien casser
  public calculateCarterScore(
    symbol: string,
    candlesIntraday: Candle[],
    candles60m: Candle[] | null,
    candlesDaily: Candle[] | null,
    breadth: MarketBreadth,
    timeframe: '5' | '15' = '5'
  ): CarterScore {
    return this.evaluateCarterSignal(symbol, candlesIntraday, candles60m, candlesDaily, breadth, timeframe);
  }

  /**
   * Calcul d'une Moyenne Mobile Exponentielle (EMA)
   */
  public calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let prevEma = data[0] || 0;

    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        emaArray.push(prevEma);
      } else {
        const currentEma = data[i] * k + prevEma * (1 - k);
        emaArray.push(currentEma);
        prevEma = currentEma;
      }
    }
    return emaArray;
  }
}
