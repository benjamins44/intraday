import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../../config/env.config';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    const dbPath = path.resolve(config.databasePath);
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    initSchema(dbInstance);
  }

  return dbInstance;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_capital REAL NOT NULL,
      available_cash REAL NOT NULL,
      invested_cash REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      sector TEXT,
      avg_volume_50d REAL DEFAULT 0,
      last_price REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_in_hotlist INTEGER DEFAULT 0,
      hotlist_rank INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      qty INTEGER NOT NULL,
      allocated_cash REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit_1 REAL NOT NULL,
      take_profit_2 REAL,
      tp1_executed INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      entry_time DATETIME NOT NULL,
      exit_price REAL,
      exit_time DATETIME,
      exit_reason TEXT,
      pnl REAL DEFAULT 0,
      pnl_percent REAL DEFAULT 0,
      score_at_entry REAL
    );

    CREATE TABLE IF NOT EXISTS market_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      nyse_tick REAL,
      nasdaq_tick REAL,
      nyse_add REAL,
      trin REAL,
      spy_price REAL,
      regime TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS engine_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      cycle_type TEXT NOT NULL,
      market_status TEXT,
      nyse_tick REAL,
      nyse_add REAL,
      trin REAL,
      spy_price REAL,
      scanned_count INTEGER DEFAULT 0,
      top_candidate TEXT,
      top_score REAL,
      decision TEXT,
      trade_executed TEXT,
      duration_ms INTEGER,
      details_json TEXT
    );
  `);

  // Migration douce : ajout des colonnes exchange et t212_ticker si absentes
  try {
    db.exec(`ALTER TABLE positions ADD COLUMN exchange TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE assets ADD COLUMN t212_ticker TEXT;`);
  } catch {}

  // Initialisation du portefeuille si vide
  const count = db.prepare('SELECT COUNT(*) as cnt FROM portfolio').get() as { cnt: number };
  if (count.cnt === 0) {
    db.prepare(`
      INSERT INTO portfolio (total_capital, available_cash, invested_cash)
      VALUES (?, ?, 0)
    `).run(config.initialCapital, config.initialCapital);
  }
}
