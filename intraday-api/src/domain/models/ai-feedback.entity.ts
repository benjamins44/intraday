export interface TradeFeedbackLesson {
  id?: number;
  symbol: string;
  sector?: string;
  marketCapProfile?: string;
  timeSlot?: string; // ex: "OPENING", "MORNING", "LUNCH_CHOP", "AFTERNOON"
  failureCategory?: string; // ex: "DILUTION", "CHOP_ZONE", "LATE_ENTRY", "STOP_TOO_TIGHT"
  keyLesson: string;
  suggestedRuleUpdate?: string;
  createdAt?: Date;
  usageCount?: number;
}

export interface TradePostMortem {
  id?: number;
  positionId: number;
  symbol: string;
  entryQuality: 'GOOD' | 'LATE' | 'CHASING';
  exitQuality: 'OPTIMAL' | 'PREMATURE_STOP' | 'LATE';
  keyLesson: string;
  suggestedRuleUpdate?: string;
  detailsJson?: string;
  createdAt?: Date;
}

export interface PreOrderAiInput {
  symbol: string;
  currentPrice: number;
  currentTimeEST: string;
  squeezeState: string;
  momentum5m: number;
  anchorTrend: string;
  momentum60m: number;
  rvol: number;
  stopLoss: number;
  takeProfit1: number;
  riskRewardRatio: number;
  nyseAdd: number;
  nyseTick: number;
  recentNewsHeadlines: string[];
  recentFeedbackLessons: string[];
}

export interface PreOrderAiDecision {
  id?: number;
  symbol: string;
  approve: boolean;
  confidence: number; // 0.0 - 1.0
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  matchedPastFailurePattern: boolean;
  reason: string;
  latencyMs?: number;
  createdAt?: Date;
}

export interface PostMortemAiInput {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: string;
  exitPrice: number;
  exitTime: string;
  durationMinutes: number;
  exitReason: string;
  pnlDollar: number;
  pnlPercent: number;
  maxPriceReached: number;
  maxGainPercent: number;
  minPriceReached: number;
  initialStopLoss: number;
  finalStopLoss: number;
  marketBreadthTrend: string;
  sector?: string;
}

export interface PostMortemAiResult {
  entryQuality: 'GOOD' | 'LATE' | 'CHASING';
  exitQuality: 'OPTIMAL' | 'PREMATURE_STOP' | 'LATE';
  keyLesson: string;
  suggestedRuleUpdate?: {
    targetParameter: string;
    proposedValue: string;
  };
}

export interface WeeklyStatsInput {
  startDate: string;
  endDate: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalPnl: number;
  openWinRate: number;
  openPnl: number;
  morningWinRate: number;
  morningPnl: number;
  lunchWinRate: number;
  lunchPnl: number;
  afternoonWinRate: number;
  afternoonPnl: number;
  tradesSummary: any[];
}

export interface WeeklyDigestResult {
  reportMarkdown: string;
  keyLessons: string[];
  suggestedConfigUpdates: Record<string, any>;
}

export interface WeeklyDigestReport {
  id?: number;
  startDate: Date;
  endDate: Date;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  reportMarkdown: string;
  suggestedUpdatesJson?: string;
  createdAt?: Date;
}
