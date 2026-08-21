import { LogRepositoryPort } from '../../../../domain/ports/out/log-repository.port';
import { EngineLog, EngineCycleType } from '../../../../domain/models/engine-log.entity';
import { getDatabase } from '../../../database/sqlite.connection';

export class SqliteLogRepository implements LogRepositoryPort {
  private db = getDatabase();

  async save(log: EngineLog): Promise<EngineLog> {
    const stmt = this.db.prepare(`
      INSERT INTO engine_logs (
        timestamp, cycle_type, market_status, nyse_tick, nyse_add,
        trin, spy_price, scanned_count, top_candidate, top_score,
        decision, trade_executed, duration_ms, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      log.timestamp.toISOString(),
      log.cycleType,
      log.marketStatus || null,
      log.nyseTick ?? null,
      log.nyseAdd ?? null,
      log.trin ?? null,
      log.spyPrice ?? null,
      log.scannedCount || 0,
      log.topCandidate || null,
      log.topScore ?? null,
      log.decision,
      log.tradeExecuted || null,
      log.durationMs || 0,
      log.detailsJson || null
    );

    return { ...log, id: Number(res.lastInsertRowid) };
  }

  async findRecent(limit = 50, cycleType?: EngineCycleType): Promise<EngineLog[]> {
    let query = 'SELECT * FROM engine_logs';
    const params: any[] = [];

    if (cycleType) {
      query += ' WHERE cycle_type = ?';
      params.push(cycleType);
    }

    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async getStats(): Promise<{
    totalCycles: number;
    totalTradesExecuted: number;
    lastCycleTime?: Date;
  }> {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM engine_logs').get() as any;
    const tradesRow = this.db
      .prepare('SELECT COUNT(*) as count FROM engine_logs WHERE trade_executed IS NOT NULL')
      .get() as any;
    const lastRow = this.db
      .prepare('SELECT timestamp FROM engine_logs ORDER BY id DESC LIMIT 1')
      .get() as any;

    return {
      totalCycles: totalRow?.count || 0,
      totalTradesExecuted: tradesRow?.count || 0,
      lastCycleTime: lastRow?.timestamp ? new Date(lastRow.timestamp) : undefined
    };
  }

  private mapRowToEntity(row: any): EngineLog {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      cycleType: row.cycle_type,
      marketStatus: row.market_status,
      nyseTick: row.nyse_tick,
      nyseAdd: row.nyse_add,
      trin: row.trin,
      spyPrice: row.spy_price,
      scannedCount: row.scanned_count,
      topCandidate: row.top_candidate,
      topScore: row.top_score,
      decision: row.decision,
      tradeExecuted: row.trade_executed,
      durationMs: row.duration_ms,
      detailsJson: row.details_json
    };
  }
}
