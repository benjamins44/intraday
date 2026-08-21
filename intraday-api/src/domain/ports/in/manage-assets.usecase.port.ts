import { Asset } from '../../models/asset.entity';

export interface ManageAssetsUseCasePort {
  getAllAssets(onlyActive?: boolean): Promise<Asset[]>;
  getHotListAssets(): Promise<Asset[]>;
  addAsset(asset: Omit<Asset, 'id'>): Promise<Asset>;
  seedTopUSAssets(): Promise<{ insertedCount: number; totalCount: number }>;
}
