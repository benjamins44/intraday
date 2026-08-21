import { Candle } from '../../models/scoring.entity';
import { MarketBreadth } from '../../models/market-breadth.entity';

export interface QuoteResult {
  price: number;
  volume: number;
  avgVolume50d?: number;
  gapPercent?: number;
  quoteTime?: Date;
  isRegularMarketOpen?: boolean;
}

export interface MarketDataPort {
  getCandles(exchange: string, symbol: string, resolution: '1' | '5' | '15' | '60' | 'D', bars: number): Promise<Candle[]>;
  getMarketBreadth(): Promise<MarketBreadth>;
  getQuote(symbol: string): Promise<QuoteResult>;
  getQuotesBatch(symbols: string[]): Promise<Map<string, QuoteResult>>;
}
