import { AiFeedbackRepositoryPort } from '../../../../domain/ports/out/ai-feedback-repository.port';
import {
  TradeFeedbackLesson,
  TradePostMortem,
  PreOrderAiDecision,
  WeeklyDigestReport
} from '../../../../domain/models/ai-feedback.entity';
import { getDatabase } from '../../../database/sqlite.connection';
import Database from 'better-sqlite3';

export class SqliteFeedbackRepository implements AiFeedbackRepositoryPort {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  async saveLesson(lesson: TradeFeedbackLesson): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO trade_feedback_lessons (
        symbol, sector, market_cap_profile, time_slot, failure_category, key_lesson, suggested_rule_update, usage_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const result = stmt.run(
      lesson.symbol,
      lesson.sector || null,
      lesson.marketCapProfile || null,
      lesson.timeSlot || null,
      lesson.failureCategory || null,
      lesson.keyLesson,
      lesson.suggestedRuleUpdate || null
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Sélectionne les leçons de feedback selon la hiérarchie RAG définie dans AI_FEEDBACK_LOOP.md :
   * 1. Même symbole
   * 2. Même secteur / profil
   * 3. Même créneau horaire
   * 4. Les échecs les plus récents
   */
  async findLessonsForContext(
    symbol: string,
    sector?: string,
    timeSlot?: string,
    limit = 5
  ): Promise<TradeFeedbackLesson[]> {
    const lessons: TradeFeedbackLesson[] = [];
    const seenIds = new Set<number>();

    const addRows = (rows: any[]) => {
      for (const row of rows) {
        if (!seenIds.has(row.id) && lessons.length < limit) {
          seenIds.add(row.id);
          lessons.push({
            id: row.id,
            symbol: row.symbol,
            sector: row.sector,
            marketCapProfile: row.market_cap_profile,
            timeSlot: row.time_slot,
            failureCategory: row.failure_category,
            keyLesson: row.key_lesson,
            suggestedRuleUpdate: row.suggested_rule_update,
            createdAt: new Date(row.created_at),
            usageCount: row.usage_count
          });
        }
      }
    };

    // Priorité 1 : Le même actif
    const bySymbol = this.db
      .prepare(`SELECT * FROM trade_feedback_lessons WHERE symbol = ? ORDER BY id DESC LIMIT ?`)
      .all(symbol, limit);
    addRows(bySymbol);

    // Priorité 2 : Même secteur
    if (sector && lessons.length < limit) {
      const bySector = this.db
        .prepare(`SELECT * FROM trade_feedback_lessons WHERE sector = ? ORDER BY id DESC LIMIT ?`)
        .all(sector, limit);
      addRows(bySector);
    }

    // Priorité 3 : Même tranche horaire
    if (timeSlot && lessons.length < limit) {
      const byTime = this.db
        .prepare(`SELECT * FROM trade_feedback_lessons WHERE time_slot = ? ORDER BY id DESC LIMIT ?`)
        .all(timeSlot, limit);
      addRows(byTime);
    }

    // Priorité 4 : Les échecs récents globaux
    if (lessons.length < limit) {
      const recent = this.db
        .prepare(`SELECT * FROM trade_feedback_lessons ORDER BY id DESC LIMIT ?`)
        .all(limit);
      addRows(recent);
    }

    return lessons;
  }

  async incrementLessonUsage(lessonId: number): Promise<void> {
    this.db.prepare(`UPDATE trade_feedback_lessons SET usage_count = usage_count + 1 WHERE id = ?`).run(lessonId);
  }

  async savePostMortem(postMortem: TradePostMortem): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO trade_post_mortems (
        position_id, symbol, entry_quality, exit_quality, key_lesson, suggested_rule_update, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      postMortem.positionId,
      postMortem.symbol,
      postMortem.entryQuality,
      postMortem.exitQuality,
      postMortem.keyLesson,
      postMortem.suggestedRuleUpdate || null,
      postMortem.detailsJson || null
    );
    return Number(result.lastInsertRowid);
  }

  async hasPostMortem(positionId: number): Promise<boolean> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM trade_post_mortems WHERE position_id = ?').get(positionId) as { cnt: number };
    return row && row.cnt > 0;
  }

  async getRecentPostMortems(limit = 10): Promise<TradePostMortem[]> {
    const rows = this.db.prepare(`SELECT * FROM trade_post_mortems ORDER BY id DESC LIMIT ?`).all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      positionId: r.position_id,
      symbol: r.symbol,
      entryQuality: r.entry_quality,
      exitQuality: r.exit_quality,
      keyLesson: r.key_lesson,
      suggestedRuleUpdate: r.suggested_rule_update,
      detailsJson: r.details_json,
      createdAt: new Date(r.created_at)
    }));
  }

  async savePreOrderDecision(decision: PreOrderAiDecision): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO pre_order_ai_decisions (
        symbol, approved, confidence, risk_level, matched_past_failure_pattern, reason, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      decision.symbol,
      decision.approve ? 1 : 0,
      decision.confidence,
      decision.riskLevel,
      decision.matchedPastFailurePattern ? 1 : 0,
      decision.reason,
      decision.latencyMs || 0
    );
    return Number(result.lastInsertRowid);
  }

  async saveWeeklyDigest(digest: WeeklyDigestReport): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO weekly_digest_reports (
        start_date, end_date, total_trades, win_rate, profit_factor, total_pnl, report_markdown, suggested_updates_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      digest.startDate.toISOString(),
      digest.endDate.toISOString(),
      digest.totalTrades,
      digest.winRate,
      digest.profitFactor,
      digest.totalPnl,
      digest.reportMarkdown,
      digest.suggestedUpdatesJson || null
    );
    return Number(result.lastInsertRowid);
  }

  async getRecentWeeklyDigests(limit = 5): Promise<WeeklyDigestReport[]> {
    const rows = this.db.prepare(`SELECT * FROM weekly_digest_reports ORDER BY id DESC LIMIT ?`).all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      startDate: new Date(r.start_date),
      endDate: new Date(r.end_date),
      totalTrades: r.total_trades,
      winRate: r.win_rate,
      profitFactor: r.profit_factor,
      totalPnl: r.total_pnl,
      reportMarkdown: r.report_markdown,
      suggestedUpdatesJson: r.suggested_updates_json,
      createdAt: new Date(r.created_at)
    }));
  }
}
