export interface Asset {
  id?: number;
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'AMEX';
  sector?: string;
  avgVolume50d?: number;
  lastPrice?: number;
  t212Ticker?: string;
  isActive: boolean;
  isInHotList: boolean;
  hotListRank?: number;
  updatedAt?: Date;
}
