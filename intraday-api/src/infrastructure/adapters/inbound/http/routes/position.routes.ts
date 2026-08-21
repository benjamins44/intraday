import { Router, Request, Response } from 'express';
import { ManagePositionsUseCasePort } from '../../../../../domain/ports/in/manage-positions.usecase.port';
import { PositionStatus } from '../../../../../domain/models/position.entity';

export function createPositionRouter(managePositionsUseCase: ManagePositionsUseCasePort): Router {
  const router = Router();

  // GET /api/positions - Liste des positions (filtrable par status)
  router.get('/', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as PositionStatus | undefined;
      const positions = await managePositionsUseCase.getPositions(status);
      res.json({ success: true, count: positions.length, data: positions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/positions/summary - Résumé portefeuille (cash, PnL, positions)
  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const summary = await managePositionsUseCase.getPortfolioSummary();
      res.json({ success: true, data: summary });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/positions/:id - Détails d'une position
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const position = await managePositionsUseCase.getPositionById(id);
      if (!position) {
        return res.status(404).json({ success: false, error: 'Position non trouvée' });
      }
      res.json({ success: true, data: position });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/positions/:id/close - Clôture manuelle d'une position
  router.post('/:id/close', async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const closed = await managePositionsUseCase.closePositionManually(id);
      res.json({ success: true, message: `Position ${id} fermée manuellement`, data: closed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/positions/square-off - Liquidation d'urgence de toutes les positions
  router.post('/square-off', async (req: Request, res: Response) => {
    try {
      const closed = await managePositionsUseCase.squareOffAll();
      res.json({ success: true, message: `Square-off effectué : ${closed.length} positions liquidées`, data: closed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/positions/reset - Réinitialisation du portefeuille à vide (1000$ cash)
  router.post('/reset', async (req: Request, res: Response) => {
    try {
      const initialCapital = (req.body && req.body.initialCapital) ? parseFloat(req.body.initialCapital) : 1000;
      const result = await managePositionsUseCase.resetPortfolio(initialCapital);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
