import { Asset } from '../../models/asset.entity';

export interface HotListResult {
  timestamp: Date;
  totalAssetsScanned: number;
  qualifiedHotListCount: number;
  hotList: Asset[];
}

export interface GenerateHotListUseCasePort {
  execute(): Promise<HotListResult>;
}
