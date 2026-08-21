import { Router, Request, Response } from 'express';
import { ManageAssetsUseCasePort } from '../../../../../domain/ports/in/manage-assets.usecase.port';

export function createAssetRouter(manageAssetsUseCase: ManageAssetsUseCasePort): Router {
  const router = Router();

  // GET /api/assets - Liste de tous les actifs
  router.get('/', async (req: Request, res: Response) => {
    try {
      const onlyActive = req.query.active !== 'false';
      const assets = await manageAssetsUseCase.getAllAssets(onlyActive);
      res.json({ success: true, count: assets.length, data: assets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/assets/hotlist - Récupérer la Hot List active
  router.get('/hotlist', async (req: Request, res: Response) => {
    try {
      const hotlist = await manageAssetsUseCase.getHotListAssets();
      res.json({ success: true, count: hotlist.length, data: hotlist });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/assets - Ajouter un actif avec contrôles stricts des éléments obligatoires
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { symbol, name, exchange, sector, t212Ticker, isActive } = req.body;

      // 1. Contrôle des champs obligatoires
      const missingFields: string[] = [];
      if (!symbol || typeof symbol !== 'string' || !symbol.trim()) missingFields.push('symbol');
      if (!name || typeof name !== 'string' || !name.trim()) missingFields.push('name');
      if (!exchange || typeof exchange !== 'string' || !exchange.trim()) missingFields.push('exchange');

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Champs obligatoires manquants ou invalides : ${missingFields.join(', ')}`,
          required: ['symbol (string)', 'name (string)', 'exchange (NASDAQ | NYSE | AMEX)']
        });
      }

      const cleanSymbol = symbol.trim().toUpperCase();
      const cleanName = name.trim();
      const cleanExchange = exchange.trim().toUpperCase();

      // 2. Contrôle du format du symbole (Lettres / chiffres de 1 à 6 caractères)
      if (!/^[A-Z0-9.\-]{1,6}$/.test(cleanSymbol)) {
        return res.status(400).json({
          success: false,
          error: `Le symbole "${cleanSymbol}" est invalide. Format attendu : 1 à 6 caractères alphanumériques.`
        });
      }

      // 3. Contrôle de la bourse (Exchange)
      const validExchanges = ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS'];
      if (!validExchanges.includes(cleanExchange)) {
        return res.status(400).json({
          success: false,
          error: `Bourse "${cleanExchange}" non supportée. Bourses autorisées : ${validExchanges.join(', ')}`
        });
      }

      // 4. Résolution ou validation du Ticker Trading 212
      let cleanT212Ticker = t212Ticker ? String(t212Ticker).trim() : undefined;
      if (!cleanT212Ticker) {
        cleanT212Ticker = `${cleanSymbol}_US_EQ`;
      }

      // 5. Enregistrement en base de données
      const asset = await manageAssetsUseCase.addAsset({
        symbol: cleanSymbol,
        name: cleanName,
        exchange: cleanExchange,
        sector: sector ? String(sector).trim() : undefined,
        t212Ticker: cleanT212Ticker,
        isActive: isActive !== false,
        isInHotList: false
      });

      res.status(201).json({
        success: true,
        message: `Actif ${cleanSymbol} (${cleanName}) ajouté avec succès en BDD.`,
        data: asset
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/assets/seed - Peupler la base avec les actions majeures US
  router.post('/seed', async (req: Request, res: Response) => {
    try {
      const result = await manageAssetsUseCase.seedTopUSAssets();
      res.json({ success: true, message: 'Peuplement initial réussi', ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
