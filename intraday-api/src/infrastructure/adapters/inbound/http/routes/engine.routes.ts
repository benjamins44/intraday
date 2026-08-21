import { Router, Request, Response } from 'express';
import { ExecuteCycleUseCasePort } from '../../../../../domain/ports/in/execute-cycle.usecase.port';
import { GenerateHotListUseCasePort } from '../../../../../domain/ports/in/generate-hotlist.usecase.port';
import { MarketDataPort } from '../../../../../domain/ports/out/market-data.port';
import { LogRepositoryPort } from '../../../../../domain/ports/out/log-repository.port';
import { EngineCycleType } from '../../../../../domain/models/engine-log.entity';

export function createEngineRouter(
  executeCycleUseCase: ExecuteCycleUseCasePort,
  generateHotListUseCase: GenerateHotListUseCasePort,
  marketData: MarketDataPort,
  logRepo: LogRepositoryPort
): Router {
  const router = Router();

  // POST /api/engine/run-cycle - Exécution manuelle ou programmée d'un cycle 1-minute
  router.post('/run-cycle', async (req: Request, res: Response) => {
    try {
      const simulatedTime = req.body.timestamp ? new Date(req.body.timestamp) : new Date();
      const force = req.body.force === true;
      const result = await executeCycleUseCase.execute(simulatedTime, force);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/engine/generate-hotlist - Déclenchement manuel du screener Hot List
  router.post('/generate-hotlist', async (_req: Request, res: Response) => {
    try {
      const result = await generateHotListUseCase.execute();
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/engine/market-breadth - Consultation en direct de la largeur de marché ($TICK, $ADD, $TRIN)
  router.get('/market-breadth', async (_req: Request, res: Response) => {
    try {
      const breadth = await marketData.getMarketBreadth();
      res.json({ success: true, data: breadth });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/engine/logs - Historique des logs d'exécution des cycles & scans
  router.get('/logs', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const type = req.query.type as EngineCycleType | undefined;
      const logs = await logRepo.findRecent(limit, type);
      res.json({ success: true, count: logs.length, data: logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/engine/stats - Statistiques d'activité du moteur
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await logRepo.getStats();
      res.json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
