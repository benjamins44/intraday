export type MarketRegime = 'NEUTRAL_RANGE' | 'TREND_DAY_BULL' | 'TREND_DAY_BEAR';

export interface MarketBreadth {
  timestamp: Date;
  nyseTick: number;
  nasdaqTick: number;
  nyseAdd: number;
  trin: number;
  spyPrice: number;
  regime: MarketRegime;
  isMarketOpen: boolean;
  canTradeFade: boolean;
}
