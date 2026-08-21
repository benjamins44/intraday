import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { createAssetRouter } from './routes/asset.routes';
import { createPositionRouter } from './routes/position.routes';
import { createEngineRouter } from './routes/engine.routes';
import { ManageAssetsUseCasePort } from '../../../../domain/ports/in/manage-assets.usecase.port';
import { ManagePositionsUseCasePort } from '../../../../domain/ports/in/manage-positions.usecase.port';
import { ExecuteCycleUseCasePort } from '../../../../domain/ports/in/execute-cycle.usecase.port';
import { GenerateHotListUseCasePort } from '../../../../domain/ports/in/generate-hotlist.usecase.port';
import { MarketDataPort } from '../../../../domain/ports/out/market-data.port';

import { LogRepositoryPort } from '../../../../domain/ports/out/log-repository.port';

export function createHttpServer(
  manageAssetsUseCase: ManageAssetsUseCasePort,
  managePositionsUseCase: ManagePositionsUseCasePort,
  executeCycleUseCase: ExecuteCycleUseCasePort,
  generateHotListUseCase: GenerateHotListUseCasePort,
  marketData: MarketDataPort,
  logRepo: LogRepositoryPort
): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'UP', service: 'intraday-api', timestamp: new Date().toISOString() });
  });

  // Montage des routes
  app.use('/api/assets', createAssetRouter(manageAssetsUseCase));
  app.use('/api/positions', createPositionRouter(managePositionsUseCase));
  app.use(
    '/api/engine',
    createEngineRouter(executeCycleUseCase, generateHotListUseCase, marketData, logRepo)
  );

  return app;
}
