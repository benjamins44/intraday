import { Asset } from '../../models/asset.entity';

export interface AssetRepositoryPort {
  save(asset: Asset): Promise<Asset>;
  saveBulk(assets: Asset[]): Promise<void>;
  findById(id: number): Promise<Asset | null>;
  findBySymbol(symbol: string): Promise<Asset | null>;
  findAll(onlyActive?: boolean): Promise<Asset[]>;
  getHotList(): Promise<Asset[]>;
  updateHotListStatus(
    symbol: string,
    inHotList: boolean,
    rank?: number,
    lastPrice?: number,
    avgVolume50d?: number
  ): Promise<void>;
  clearHotList(): Promise<void>;
  count(): Promise<number>;
  deleteAll(): Promise<void>;
}
