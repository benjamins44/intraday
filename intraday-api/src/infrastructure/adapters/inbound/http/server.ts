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

import { createFeedbackRouter } from './routes/feedback.routes';
import { PostMortemTradeUseCase } from '../../../../application/usecases/post-mortem-trade.usecase';
import { WeeklyDigestUseCase } from '../../../../application/usecases/weekly-digest.usecase';
import { AiFeedbackRepositoryPort } from '../../../../domain/ports/out/ai-feedback-repository.port';
import { PositionRepositoryPort } from '../../../../domain/ports/out/position-repository.port';

import { spawnSync } from 'child_process';
import { config } from '../../../../config/env.config';

async function checkAgyHealth(): Promise<{
  status: 'OK' | 'ERROR';
  version?: string;
  realPromptInference: boolean;
  responseVerified: boolean;
  latencyMs?: number;
  responsePayload?: any;
  error?: string;
}> {
  const startTime = Date.now();
  try {
    const agyBin = config.agyBinPath || 'agy';
    // 1. Vérification du binaire et de sa version
    const versionResult = spawnSync(agyBin, ['--version'], { encoding: 'utf-8', timeout: 3000 });
    const version = versionResult.stdout ? versionResult.stdout.trim() : undefined;

    // 2. VRAI appel d'inférence LLM avec prompt de test
    const prompt = 'Reponds STRICTEMENT avec le JSON brut suivant sans bloc markdown : {"status":"ok","model":"gemini-3.7-flash","ping":"pong"}';
    const result = spawnSync(
      agyBin,
      ['--dangerously-skip-permissions', '--mode', 'plan', '-p', prompt],
      { encoding: 'utf-8', timeout: 15000 }
    );

    const latencyMs = Date.now() - startTime;

    if (result.error) {
      return {
        status: 'ERROR',
        version,
        realPromptInference: false,
        responseVerified: false,
        latencyMs,
        error: result.error.message
      };
    }

    const stdout = (result.stdout || '').trim();
    if (result.status !== 0 || !stdout) {
      return {
        status: 'ERROR',
        version,
        realPromptInference: false,
        responseVerified: false,
        latencyMs,
        error: (result.stderr || `Exit code ${result.status}`).trim()
      };
    }

    // 3. Extraction et vérification stricte de la réponse JSON
    let cleanText = stdout;
    if (cleanText.includes('```')) {
      const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) cleanText = match[1].trim();
    }

    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return {
        status: 'ERROR',
        version,
        realPromptInference: true,
        responseVerified: false,
        latencyMs,
        error: `Format JSON introuvable dans la réponse reçue : ${stdout}`
      };
    }

    const parsed = JSON.parse(cleanText.substring(start, end + 1));
    const isVerified = parsed.status === 'ok' || parsed.ping === 'pong';

    if (!isVerified) {
      return {
        status: 'ERROR',
        version,
        realPromptInference: true,
        responseVerified: false,
        latencyMs,
        responsePayload: parsed,
        error: 'Réponse IA non conforme au ping attendu'
      };
    }

    return {
      status: 'OK',
      version,
      realPromptInference: true,
      responseVerified: true,
      latencyMs,
      responsePayload: parsed
    };
  } catch (err: any) {
    return {
      status: 'ERROR',
      realPromptInference: false,
      responseVerified: false,
      latencyMs: Date.now() - startTime,
      error: err.message
    };
  }
}

export function createHttpServer(
  manageAssetsUseCase: ManageAssetsUseCasePort,
  managePositionsUseCase: ManagePositionsUseCasePort,
  executeCycleUseCase: ExecuteCycleUseCasePort,
  generateHotListUseCase: GenerateHotListUseCasePort,
  marketData: MarketDataPort,
  logRepo: LogRepositoryPort,
  postMortemUseCase?: PostMortemTradeUseCase,
  weeklyDigestUseCase?: WeeklyDigestUseCase,
  feedbackRepo?: AiFeedbackRepositoryPort,
  positionRepo?: PositionRepositoryPort
): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check avec VRAI test d'inférence LLM et vérification de la réponse reçue
  app.get('/health', async (_req: Request, res: Response) => {
    const agyHealth = await checkAgyHealth();
    const httpStatus = agyHealth.status === 'OK' ? 200 : 503;

    res.status(httpStatus).json({
      status: agyHealth.status === 'OK' ? 'UP' : 'DEGRADED',
      service: 'intraday-api',
      timestamp: new Date().toISOString(),
      components: {
        database: 'OK',
        antigravityCli: {
          status: agyHealth.status,
          bin: config.agyBinPath || 'agy',
          version: agyHealth.version,
          realPromptInference: agyHealth.realPromptInference,
          responseVerified: agyHealth.responseVerified,
          latencyMs: agyHealth.latencyMs,
          responsePayload: agyHealth.responsePayload,
          error: agyHealth.error,
          model: config.geminiModel,
          preOrderFilterEnabled: config.enableAiPreOrderFilter,
          postMortemEnabled: config.enableAiPostMortem
        }
      }
    });
  });

  // Montage des routes
  app.use('/api/assets', createAssetRouter(manageAssetsUseCase));
  app.use('/api/positions', createPositionRouter(managePositionsUseCase));
  app.use(
    '/api/engine',
    createEngineRouter(executeCycleUseCase, generateHotListUseCase, marketData, logRepo)
  );

  if (postMortemUseCase && weeklyDigestUseCase && feedbackRepo && positionRepo) {
    app.use(
      '/api/feedback',
      createFeedbackRouter(postMortemUseCase, weeklyDigestUseCase, feedbackRepo, positionRepo)
    );
  }

  return app;
}
