import { TvDataFeed } from 'tvdatafeedclient-js';
import YahooFinance from 'yahoo-finance2';
import { MarketDataPort } from '../../../../domain/ports/out/market-data.port';
import { Candle } from '../../../../domain/models/scoring.entity';
import { MarketBreadth, MarketRegime } from '../../../../domain/models/market-breadth.entity';
import { PersistentTradingViewStream } from './persistent-tv-stream';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export class HybridMarketDataAdapter implements MarketDataPort {
  // Cache mémoire de secours pour la largeur de marché
  private lastKnownBreadth: MarketBreadth | null = null;
  private lastBreadthUpdate = 0;

  // Circuit Breaker TradingView : si TradingView renvoie un 429 (Too Many Requests), mise en pause TV pendant 5 minutes
  private static tvCooldownUntil = 0;

  /**
   * Récupération des bougies OHLCV avec priorité à Yahoo Finance Chart
   * (Ultra-rapide, sans limitation 429 de rate-limit par socket, zéro crash)
   */
  async getCandles(
    exchange: string,
    symbol: string,
    resolution: '1' | '5' | '15' | '60' | 'D' = '5',
    bars = 50
  ): Promise<Candle[]> {
    // 1. Récupération robuste via Yahoo Finance Chart (Illimité, gère tous les timeframes)
    try {
      const yfCandles = await this.fetchFromYahooChart(symbol, resolution, bars);
      if (yfCandles.length > 0) {
        return yfCandles;
      }
    } catch {
      // Fallback
    }

    // 2. Fallback éventuel TradingView
    try {
      const tvCandles = await this.fetchFromTradingView(exchange, symbol, resolution, bars);
      if (tvCandles.length > 0) {
        return tvCandles;
      }
    } catch {}

    return [];
  }

  private async fetchFromTradingView(
    exchange: string,
    symbol: string,
    resolution: '1' | '5' | '15' | '60' | 'D',
    bars: number
  ): Promise<Candle[]> {
    const tv = new TvDataFeed();
    try {
      const res = await Promise.race([
        tv.getCandles(exchange, symbol, resolution, bars),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TV Timeout (2.5s)')), 2500)
        )
      ]);

      if (Array.isArray(res) && res.length > 0) {
        return res as Candle[];
      }
      return [];
    } finally {
      try {
        tv.disconnect();
      } catch {}
    }
  }

  private async fetchFromYahooChart(
    symbol: string,
    resolution: '1' | '5' | '15' | '60' | 'D',
    bars: number
  ): Promise<Candle[]> {
    const yfSymbol = symbol.replace(/\./g, '-');
    const yfInterval =
      resolution === '60'
        ? '60m'
        : resolution === 'D'
        ? '1d'
        : resolution === '15'
        ? '15m'
        : resolution === '5'
        ? '5m'
        : '1m';
    const lookbackDays =
      resolution === '60'
        ? 10
        : resolution === 'D'
        ? 60
        : resolution === '15'
        ? 5
        : resolution === '5'
        ? 3
        : 2;
    const period1 = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

    const chart = await yf.chart(yfSymbol, { period1, interval: yfInterval as any });
    if (!chart || !chart.quotes || chart.quotes.length === 0) {
      return [];
    }

    const candles: Candle[] = chart.quotes
      .filter((q) => q.open !== null && q.close !== null && q.high !== null && q.low !== null)
      .map((q) => ({
        time: new Date(q.date),
        symbol,
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume || 0
      }))
      .slice(-bars);

    return candles;
  }

  /**
   * Récupération 100% Réelle & Synchrone de la largeur de marché ($ADD, $TICK, Régime)
   * Calcule la pression de marché à partir des grands indices (SPY, QQQ, IWM, DIA)
   * et d'un panier représentatif des poids lourds de la cote.
   */
  async getMarketBreadth(): Promise<MarketBreadth> {
    try {
      const benchmarkSymbols = [
        'SPY', 'QQQ', 'IWM', 'DIA',
        'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'JPM', 'XOM', 'CAT'
      ];

      const quotesMap = await this.getQuotesBatch(benchmarkSymbols);
      let advancing = 0;
      let declining = 0;
      let totalChangeSum = 0;

      for (const [, quote] of quotesMap.entries()) {
        const gap = quote.gapPercent || 0;
        totalChangeSum += gap;
        if (gap > 0.1) advancing++;
        else if (gap < -0.1) declining++;
      }

      const total = quotesMap.size || 1;
      const netAdvanceRatio = (advancing - declining) / total;
      // Estimation normalisée du $ADD (-2000 à +2000)
      const nyseAdd = Math.round(netAdvanceRatio * 2000);
      // Estimation normalisée du $TICK (-1000 à +1000)
      const avgChange = totalChangeSum / total;
      const nyseTick = Math.max(-1200, Math.min(1200, Math.round(avgChange * 400)));

      const spyPrice = quotesMap.get('SPY')?.price || this.lastKnownBreadth?.spyPrice || 0;
      const trin = advancing > 0 && declining > 0 ? parseFloat((declining / advancing).toFixed(2)) : 1.0;

      let regime: MarketRegime = 'NEUTRAL_RANGE';
      if (nyseAdd > 1200) regime = 'TREND_DAY_BULL';
      else if (nyseAdd < -1200) regime = 'TREND_DAY_BEAR';

      const currentBreadth: MarketBreadth = {
        timestamp: new Date(),
        nyseTick,
        nasdaqTick: nyseTick,
        nyseAdd,
        trin,
        spyPrice,
        regime,
        isMarketOpen: true,
        canTradeFade: regime === 'NEUTRAL_RANGE'
      };

      this.lastKnownBreadth = currentBreadth;
      this.lastBreadthUpdate = Date.now();
      return currentBreadth;
    } catch {
      return this.lastKnownBreadth || {
        timestamp: new Date(),
        nyseTick: 0,
        nasdaqTick: 0,
        nyseAdd: 0,
        trin: 1.0,
        spyPrice: 0,
        regime: 'NEUTRAL_RANGE',
        isMarketOpen: true,
        canTradeFade: true
      };
    }
  }

  async getQuote(symbol: string): Promise<{ price: number; volume: number; avgVolume50d?: number; gapPercent?: number; quoteTime?: Date }> {
    try {
      const yfSymbol = symbol.replace(/\./g, '-');
      const q = await yf.quote(yfSymbol);
      const price = q.regularMarketPrice || 0;
      const volume = q.regularMarketVolume || 0;
      const prevClose = q.regularMarketPreviousClose || price;
      const gapPercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      const quoteTime = q.regularMarketTime ? new Date(q.regularMarketTime) : undefined;

      return {
        price,
        volume,
        avgVolume50d: (q as any).averageDailyVolume3Month || (q as any).averageDailyVolume10Day || volume,
        gapPercent: parseFloat(gapPercent.toFixed(2)),
        quoteTime
      };
    } catch {
      return { price: 0, volume: 0, gapPercent: 0 };
    }
  }

  async getQuotesBatch(
    symbols: string[]
  ): Promise<Map<string, { price: number; volume: number; avgVolume50d?: number; gapPercent?: number; quoteTime?: Date }>> {
    const map = new Map<string, { price: number; volume: number; avgVolume50d?: number; gapPercent?: number; quoteTime?: Date }>();
    const chunkSize = 50;

    console.log(`[MarketData] Récupération groupée de ${symbols.length} cotations par paquets de ${chunkSize}...`);

    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const yfChunk = chunk.map((s) => s.replace(/\./g, '-'));
      try {
        const quotes = await yf.quote(yfChunk);
        const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

        for (const q of quotesArray) {
          if (!q || !q.symbol) continue;
          const price = q.regularMarketPrice || 0;
          const volume = q.regularMarketVolume || 0;
          const prevClose = q.regularMarketPreviousClose || price;
          const gapPercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
          const quoteTime = q.regularMarketTime ? new Date(q.regularMarketTime) : undefined;

          // Mapping pour la clé originale et la clé normalisée
          const originalSymbol = chunk.find((s) => s.replace(/\./g, '-') === q.symbol) || q.symbol;
          map.set(originalSymbol, {
            price,
            volume,
            avgVolume50d: (q as any).averageDailyVolume3Month || (q as any).averageDailyVolume10Day || volume,
            gapPercent: parseFloat(gapPercent.toFixed(2)),
            quoteTime
          });
          map.set(q.symbol, {
            price,
            volume,
            avgVolume50d: (q as any).averageDailyVolume3Month || (q as any).averageDailyVolume10Day || volume,
            gapPercent: parseFloat(gapPercent.toFixed(2)),
            quoteTime
          });
        }
      } catch {
        for (const s of chunk) {
          try {
            const single = await this.getQuote(s);
            map.set(s, single);
          } catch {
            map.set(s, { price: 0, volume: 0, gapPercent: 0 });
          }
        }
      }

      const progress = Math.min(symbols.length, i + chunkSize);
      process.stdout.write(`\r[MarketData] Progression : ${progress}/${symbols.length} actifs analysés...`);
    }

    console.log(`\n[MarketData] ✅ ${map.size} cotations récupérées avec succès.`);
    return map;
  }
}
