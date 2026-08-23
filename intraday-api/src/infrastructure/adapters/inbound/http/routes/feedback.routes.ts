import { Router, Request, Response } from 'express';
import { PostMortemTradeUseCase } from '../../../../../application/usecases/post-mortem-trade.usecase';
import { WeeklyDigestUseCase } from '../../../../../application/usecases/weekly-digest.usecase';
import { AiFeedbackRepositoryPort } from '../../../../../domain/ports/out/ai-feedback-repository.port';
import { PositionRepositoryPort } from '../../../../../domain/ports/out/position-repository.port';

export function createFeedbackRouter(
  postMortemUseCase: PostMortemTradeUseCase,
  weeklyDigestUseCase: WeeklyDigestUseCase,
  feedbackRepo: AiFeedbackRepositoryPort,
  positionRepo: PositionRepositoryPort
): Router {
  const router = Router();

  // POST /api/feedback/post-mortem/:positionId
  router.post('/post-mortem/:positionId', async (req: Request, res: Response) => {
    try {
      const positionIdParam = Array.isArray(req.params.positionId) ? req.params.positionId[0] : req.params.positionId;
      const positionId = parseInt(positionIdParam, 10);
      const position = await positionRepo.findById(positionId);

      if (!position) {
        return res.status(404).json({ error: `Position #${positionId} introuvable.` });
      }

      const postMortem = await postMortemUseCase.execute(position);
      return res.json({ success: true, postMortem });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/feedback/weekly-digest
  router.post('/weekly-digest', async (req: Request, res: Response) => {
    try {
      const lookbackDays = parseInt(req.body.lookbackDays, 10) || 7;
      const digest = await weeklyDigestUseCase.execute(lookbackDays);
      return res.json({ success: true, digest });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/feedback/lessons
  router.get('/lessons', async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) || '';
      const sector = (req.query.sector as string) || undefined;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const lessons = await feedbackRepo.findLessonsForContext(symbol, sector, undefined, limit);
      return res.json({ success: true, count: lessons.length, lessons });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/feedback/post-mortems
  router.get('/post-mortems', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const postMortems = await feedbackRepo.getRecentPostMortems(limit);
      return res.json({ success: true, count: postMortems.length, postMortems });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/feedback/weekly-digests
  router.get('/weekly-digests', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const digests = await feedbackRepo.getRecentWeeklyDigests(limit);
      return res.json({ success: true, count: digests.length, digests });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
