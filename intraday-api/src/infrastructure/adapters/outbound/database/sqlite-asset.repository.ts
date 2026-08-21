import { AssetRepositoryPort } from '../../../../domain/ports/out/asset-repository.port';
import { Asset } from '../../../../domain/models/asset.entity';
import { getDatabase } from '../../../database/sqlite.connection';

export class SqliteAssetRepository implements AssetRepositoryPort {
  private db = getDatabase();

  async save(asset: Asset): Promise<Asset> {
    const stmt = this.db.prepare(`
      INSERT INTO assets (symbol, name, exchange, sector, avg_volume_50d, last_price, t212_ticker, is_active, is_in_hotlist, hotlist_rank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(symbol) DO UPDATE SET
        name = excluded.name,
        exchange = excluded.exchange,
        sector = excluded.sector,
        avg_volume_50d = excluded.avg_volume_50d,
        last_price = excluded.last_price,
        t212_ticker = COALESCE(excluded.t212_ticker, assets.t212_ticker),
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP
    `);

    const res = stmt.run(
      asset.symbol,
      asset.name,
      asset.exchange,
      asset.sector || null,
      asset.avgVolume50d || 0,
      asset.lastPrice || 0,
      asset.t212Ticker || null,
      asset.isActive ? 1 : 0,
      asset.isInHotList ? 1 : 0,
      asset.hotListRank || null
    );

    return { ...asset, id: Number(res.lastInsertRowid) };
  }

  async saveBulk(assets: Asset[]): Promise<void> {
    const insert = this.db.prepare(`
      INSERT INTO assets (symbol, name, exchange, sector, avg_volume_50d, last_price, t212_ticker, is_active, is_in_hotlist, hotlist_rank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(symbol) DO UPDATE SET
        name = excluded.name,
        exchange = excluded.exchange,
        sector = excluded.sector,
        avg_volume_50d = excluded.avg_volume_50d,
        last_price = excluded.last_price,
        t212_ticker = COALESCE(excluded.t212_ticker, assets.t212_ticker),
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP
    `);

    const tx = this.db.transaction((items: Asset[]) => {
      for (const a of items) {
        insert.run(
          a.symbol,
          a.name,
          a.exchange,
          a.sector || null,
          a.avgVolume50d || 0,
          a.lastPrice || 0,
          a.t212Ticker || null,
          a.isActive ? 1 : 0,
          a.isInHotList ? 1 : 0,
          a.hotListRank || null
        );
      }
    });

    tx(assets);
  }

  async findById(id: number): Promise<Asset | null> {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as any;
    return row ? this.mapRowToEntity(row) : null;
  }

  async findBySymbol(symbol: string): Promise<Asset | null> {
    const row = this.db.prepare('SELECT * FROM assets WHERE symbol = ?').get(symbol) as any;
    return row ? this.mapRowToEntity(row) : null;
  }

  async findAll(onlyActive = true): Promise<Asset[]> {
    const query = onlyActive
      ? 'SELECT * FROM assets WHERE is_active = 1 ORDER BY symbol ASC'
      : 'SELECT * FROM assets ORDER BY symbol ASC';
    const rows = this.db.prepare(query).all() as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async getHotList(): Promise<Asset[]> {
    const rows = this.db
      .prepare('SELECT * FROM assets WHERE is_in_hotlist = 1 ORDER BY hotlist_rank ASC, symbol ASC')
      .all() as any[];
    return rows.map((r) => this.mapRowToEntity(r));
  }

  async updateHotListStatus(
    symbol: string,
    inHotList: boolean,
    rank?: number,
    lastPrice?: number,
    avgVolume50d?: number
  ): Promise<void> {
    if (lastPrice !== undefined || avgVolume50d !== undefined) {
      this.db
        .prepare(`
          UPDATE assets SET
            is_in_hotlist = ?,
            hotlist_rank = ?,
            last_price = COALESCE(?, last_price),
            avg_volume_50d = COALESCE(?, avg_volume_50d),
            updated_at = CURRENT_TIMESTAMP
          WHERE symbol = ?
        `)
        .run(inHotList ? 1 : 0, rank || null, lastPrice || null, avgVolume50d || null, symbol);
    } else {
      this.db
        .prepare(
          'UPDATE assets SET is_in_hotlist = ?, hotlist_rank = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?'
        )
        .run(inHotList ? 1 : 0, rank || null, symbol);
    }
  }

  async clearHotList(): Promise<void> {
    this.db.prepare('UPDATE assets SET is_in_hotlist = 0, hotlist_rank = NULL').run();
  }

  async count(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM assets').get() as any;
    return row.count;
  }

  private mapRowToEntity(row: any): Asset {
    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      exchange: row.exchange,
      sector: row.sector,
      avgVolume50d: row.avg_volume_50d,
      lastPrice: row.last_price,
      t212Ticker: row.t212_ticker || undefined,
      isActive: Boolean(row.is_active),
      isInHotList: Boolean(row.is_in_hotlist),
      hotListRank: row.hotlist_rank,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    };
  }
}
