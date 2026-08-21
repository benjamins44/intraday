import { PositionRepositoryPort } from '../../../../domain/ports/out/position-repository.port';
import { Position, PositionStatus } from '../../../../domain/models/position.entity';
import { getDatabase } from '../../../database/sqlite.connection';

export class SqlitePositionRepository implements PositionRepositoryPort {
  private db = getDatabase();

  async save(position: Position): Promise<Position> {
    const stmt = this.db.prepare(`
      INSERT INTO positions (
        symbol, exchange, side, entry_price, current_price, qty, allocated_cash,
        stop_loss, take_profit_1, take_profit_2, tp1_executed,
        status, entry_time, exit_price, exit_time, exit_reason,
        pnl, pnl_percent, score_at_entry
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      position.symbol,
      position.exchange || 'NASDAQ',
      position.side,
      position.entryPrice,
      position.currentPrice,
      position.qty,
      position.allocatedCash,
      position.stopLoss,
      position.takeProfit1,
      position.takeProfit2 || null,
      position.tp1Executed ? 1 : 0,
      position.status,
      position.entryTime.toISOString(),
      position.exitPrice || null,
      position.exitTime ? position.exitTime.toISOString() : null,
      position.exitReason || null,
      position.pnl || 0,
      position.pnlPercent || 0,
      position.scoreAtEntry || null
    );

    return { ...position, id: Number(res.lastInsertRowid) };
  }

  async update(position: Position): Promise<Position> {
    if (!position.id) throw new Error('Position ID obligatoire pour update');

    this.db
      .prepare(`
        UPDATE positions SET
          current_price = ?,
          stop_loss = ?,
          take_profit_1 = ?,
          take_profit_2 = ?,
          tp1_executed = ?,
          status = ?,
          exit_price = ?,
          exit_time = ?,
          exit_reason = ?,
          pnl = ?,
          pnl_percent = ?
        WHERE id = ?
      `)
      .run(
        position.currentPrice,
        position.stopLoss,
        position.takeProfit1,
        position.takeProfit2 || null,
        position.tp1Executed ? 1 : 0,
        position.status,
        position.exitPrice || null,
        position.exitTime ? position.exitTime.toISOString() : null,
        position.exitReason || null,
        position.pnl || 0,
        position.pnlPercent || 0,
        position.id
      );

    return position;
  }

  async findById(id: number): Promise<Position | null> {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as any;
    return row ? this.mapRowToEntity(row) : null;
  }

  async findOpenPositions(): Promise<Position[]> {
    const rows = this.db
      .prepare("SELECT * FROM positions WHERE status = 'OPEN' ORDER BY entry_time DESC")
      .all() as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async findByStatus(status: PositionStatus): Promise<Position[]> {
    const rows = this.db
      .prepare('SELECT * FROM positions WHERE status = ? ORDER BY entry_time DESC')
      .all(status) as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async findAll(): Promise<Position[]> {
    const rows = this.db.prepare('SELECT * FROM positions ORDER BY entry_time DESC').all() as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async countOpen(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'")
      .get() as any;
    return row.count;
  }

  async getPortfolioCash(): Promise<{ totalCapital: number; availableCash: number; investedCash: number }> {
    const row = this.db
      .prepare('SELECT total_capital, available_cash, invested_cash FROM portfolio ORDER BY id DESC LIMIT 1')
      .get() as any;

    if (!row) return { totalCapital: 100000, availableCash: 100000, investedCash: 0 };
    return {
      totalCapital: row.total_capital,
      availableCash: row.available_cash,
      investedCash: row.invested_cash
    };
  }

  async updatePortfolioCash(availableCash: number): Promise<void> {
    // Calcul de la somme réelle engagée dans les positions actuellement OUVERTES
    const openRow = this.db
      .prepare("SELECT COALESCE(SUM(allocated_cash), 0) as total_invested FROM positions WHERE status = 'OPEN'")
      .get() as any;
    const invested = openRow ? openRow.total_invested : 0;
    const totalCapital = parseFloat((availableCash + invested).toFixed(2));

    this.db
      .prepare(
        'UPDATE portfolio SET available_cash = ?, invested_cash = ?, total_capital = ?, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM portfolio ORDER BY id DESC LIMIT 1)'
      )
      .run(availableCash, invested, totalCapital);
  }

  async deleteAll(): Promise<void> {
    this.db.prepare('DELETE FROM positions').run();
  }

  private mapRowToEntity(row: any): Position {
    return {
      id: row.id,
      symbol: row.symbol,
      exchange: row.exchange || undefined,
      side: row.side,
      entryPrice: row.entry_price,
      currentPrice: row.current_price,
      qty: row.qty,
      allocatedCash: row.allocated_cash,
      stopLoss: row.stop_loss,
      takeProfit1: row.take_profit_1,
      takeProfit2: row.take_profit_2 || undefined,
      tp1Executed: Boolean(row.tp1_executed),
      status: row.status,
      entryTime: new Date(row.entry_time),
      exitPrice: row.exit_price || undefined,
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      exitReason: row.exit_reason || undefined,
      pnl: row.pnl,
      pnlPercent: row.pnl_percent,
      scoreAtEntry: row.score_at_entry
    };
  }
}
