import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: process.env.DATABASE_PATH || './data/intraday.db',
  
  // Trading & Money Management (Méthodologie Pure John Carter)
  initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '100000'),
  riskPerTradePercent: parseFloat(process.env.RISK_PER_TRADE_PERCENT || '0.01'), // Risque strict 1% du capital par trade
  maxPositionUnits: parseInt(process.env.MAX_POSITION_UNITS || '1000', 10), // Plafond N_max_user en titres
  maxPositionCapital: parseFloat(process.env.MAX_POSITION_CAPITAL || '30000'), // Plafond capital max par trade
  maxSlPercent: parseFloat(process.env.MAX_SL_PERCENT || '0.03'),
  intradayResolution: (process.env.INTRADAY_RESOLUTION || '5') as '5' | '15',
  scoreEntryThreshold: parseInt(process.env.SCORE_ENTRY_THRESHOLD || '70', 10),

  // Horaires de Marché US (Fuseau America/New_York)
  marketOpenEst: process.env.MARKET_OPEN_EST || '10:00', // Début effectif des entrées de trade (16h00 Paris)
  realMarketOpenEst: process.env.REAL_MARKET_OPEN_EST || '09:30', // Cloche d'ouverture Wall Street
  newEntryCutoffEst: process.env.NEW_ENTRY_CUTOFF_EST || '15:30', // Arrêt strict des nouvelles entrées (21h30 Paris - John Carter)
  squareOffEst: process.env.SQUARE_OFF_EST || '15:45', // Square-off strict liquidation des positions (21h45 Paris)
  marketCloseEst: process.env.MARKET_CLOSE_EST || '16:00',

  // Trading 212 API Configuration
  t212ApiKey: process.env.KEY_T212 || '',
  t212ApiSecret: process.env.SECRET_T212 || '',
  t212ApiUrl: process.env.T212_API_URL || 'https://demo.trading212.com',

  // AI & Feedback Loop (Antigravity agy / Gemini 3.7 Flash)
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
  agyBinPath: process.env.AGY_BIN_PATH || 'agy',
  enableAiPreOrderFilter: process.env.ENABLE_AI_PRE_ORDER_FILTER === 'true', // Étape 2 : désactivé par défaut (activable par env)
  enableAiPostMortem: process.env.ENABLE_AI_POST_MORTEM !== 'false', // Étape 1 : Coach Quant post-trade actif par défaut

  // Cron
  enableCron: process.env.ENABLE_CRON !== 'false',
  cron1mSchedule: process.env.CRON_1M_SCHEDULE || '* * * * *',
  cronHotListSchedule: process.env.CRON_HOTLIST_SCHEDULE || '15 9 * * 1-5'
};
