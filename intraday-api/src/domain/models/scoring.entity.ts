export interface Candle {
  time: Date;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CarterSignalCriteria {
  // Porte 1 : Largeur de Marché
  marketConditionValid: boolean;
  nyseAdd: number;
  nyseTick: number;

  // Porte 2 : Anchor Chart 60m
  anchorTrendValid: boolean;
  momentum60m: number;
  ema8_60m?: number;
  ema21_60m?: number;

  // Porte 3 : TTM Squeeze 5m
  squeezeTriggerValid: boolean;
  inSqueeze: boolean;
  squeezeFired: boolean;
  momentum5m: number;
  momentumHistColor: 'CYAN' | 'BLUE' | 'RED' | 'YELLOW';
  momentumSlope: 'RISING' | 'FALLING';

  // Porte 4 : Volume Institutionnel
  rvolValid: boolean;
  rvol: number;

  // Porte 5 : Ratio Risque/Rendement
  riskRewardValid: boolean;
  riskRewardRatio: number;
}

export interface CarterSignal {
  symbol: string;
  timestamp: Date;
  timeframe: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  isValid: boolean; // TRUE si et seulement si TOUS les critères sont validés
  rejectionReason?: string;

  // Métriques de validation
  criteria: CarterSignalCriteria;

  // Métriques directes
  inSqueeze: boolean;
  squeezeFired: boolean;
  momentum: number;
  momentumHistColor: 'CYAN' | 'BLUE' | 'RED' | 'YELLOW';
  momentumSlope: 'RISING' | 'FALLING';
  momentum60m?: number;
  momentumSlope60m?: 'RISING' | 'FALLING';
  rvol: number;

  // Prix et Niveaux d'Exécution
  currentPrice: number;
  atr14: number;
  stopLossLevel: number;
  takeProfit1Level: number;
  takeProfit2Level?: number;
  pivotPoints?: {
    pivot: number;
    r1: number;
    r2: number;
    s1: number;
    s2: number;
  };
}

// Alias de transition pour rétrocompatibilité
export type CarterScore = CarterSignal & {
  scoreTotal: number;
  squeezeScore?: number;
  anchorScore?: number;
  rvolScore?: number;
  breadthScore?: number;
};
