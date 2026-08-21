import {
  GenerateHotListUseCasePort,
  HotListResult
} from '../../domain/ports/in/generate-hotlist.usecase.port';
import { AssetRepositoryPort } from '../../domain/ports/out/asset-repository.port';
import { MarketDataPort } from '../../domain/ports/out/market-data.port';
import { CarterIndicatorsService } from '../../domain/services/carter-indicators.service';
import { Asset } from '../../domain/models/asset.entity';

import { LogRepositoryPort } from '../../domain/ports/out/log-repository.port';

export class GenerateHotListUseCase implements GenerateHotListUseCasePort {
  constructor(
    private assetRepo: AssetRepositoryPort,
    private marketData: MarketDataPort,
    private indicatorsService: CarterIndicatorsService,
    private logRepo?: LogRepositoryPort
  ) {}

  async execute(): Promise<HotListResult> {
    const startTime = Date.now();
    console.log('\n[HotList Screener] Démarrage de la génération de la Hot List pré-marché...');
    const allAssets = await this.assetRepo.findAll(true);
    console.log(`[HotList Screener] ${allAssets.length} actifs actifs chargés depuis la BDD SQLite.`);

    // 1. Récupération des quotes (Batch)
    const symbols = allAssets.map((a) => a.symbol);
    const quotesMap = await this.marketData.getQuotesBatch(symbols);

    // 2. Filtrage statique (Volume 50j >= 1M & Prix >= 10$)
    const preFiltered: { asset: Asset; quote: any; rankScore: number }[] = [];

    for (const asset of allAssets) {
      const q = quotesMap.get(asset.symbol);
      if (!q) continue;

      const price = q.price || asset.lastPrice || 0;
      const avgVol = q.avgVolume50d || asset.avgVolume50d || 0;
      const gap = Math.abs(q.gapPercent || 0);

      // Critères John Carter
      if (price < 10.0 || avgVol < 500000) continue;

      // Score de qualification pré-marché (Gap + Volume)
      const rankScore = gap * 10 + (avgVol / 1000000) * 2;
      preFiltered.push({ asset, quote: q, rankScore });
    }

    // 3. Tri des meilleures opportunités
    preFiltered.sort((a, b) => b.rankScore - a.rankScore);

    // 4. Analyse Squeeze 60-min sur les top candidats par lots de 5
    const hotListQualified: Asset[] = [];
    const topCandidates = preFiltered.slice(0, 80);
    console.log(`[HotList Screener] Évaluation du TTM Squeeze 60m sur les ${topCandidates.length} meilleurs candidats...`);

    const chunkSize = 5;
    for (let i = 0; i < topCandidates.length && hotListQualified.length < 50; i += chunkSize) {
      const chunk = topCandidates.slice(i, i + chunkSize);
      const promises = chunk.map(async (item) => {
        const candles60m = await this.marketData.getCandles(item.asset.exchange, item.asset.symbol, '60', 30);
        const sq = this.indicatorsService.evaluateTTMSqueeze(candles60m, 20);
        return { item, sq };
      });

      const chunkResults = await Promise.all(promises);

      for (const { item, sq } of chunkResults) {
        if (hotListQualified.length >= 50) break;
        
        // Qualification stricte John Carter : Données 60m obligatoires et compression ou gap significatif
        const hasValid60mData = sq && sq.atr > 0;
        if (!hasValid60mData) {
          continue; // Rejeter tout actif sans historique 60m valide
        }

        const isSqueezeQualified = sq.inSqueeze || sq.squeezeFired;
        const isGapQualified = Math.abs(item.quote.gapPercent || 0) >= 1.5;

        if (isSqueezeQualified || isGapQualified) {
          item.asset.isInHotList = true;
          item.asset.hotListRank = hotListQualified.length + 1;
          item.asset.lastPrice = item.quote.price;
          item.asset.avgVolume50d = item.quote.avgVolume50d;
          hotListQualified.push(item.asset);
        }
      }

      process.stdout.write(`\r[HotList Screener] Progression : ${hotListQualified.length}/50 actions qualifiées...`);
    }

    console.log(`\n[HotList Screener] Mise à jour de la base SQLite...`);
    // 5. Mise à jour de la base SQLite avec prix et volumes réels
    await this.assetRepo.clearHotList();
    for (const qualified of hotListQualified) {
      await this.assetRepo.updateHotListStatus(
        qualified.symbol,
        true,
        qualified.hotListRank,
        qualified.lastPrice,
        qualified.avgVolume50d
      );
    }

    console.log(`[HotList Screener] ✅ Hot List générée avec succès : ${hotListQualified.length} actions qualifiées.`);

    if (this.logRepo) {
      await this.logRepo.save({
        timestamp: new Date(),
        cycleType: 'HOTLIST_SCAN',
        marketStatus: 'Pré-marché',
        scannedCount: allAssets.length,
        decision: `QUALIFIED_${hotListQualified.length}_ACTIONS`,
        durationMs: Date.now() - startTime,
        detailsJson: JSON.stringify({
          hotList: hotListQualified.map((h) => ({ symbol: h.symbol, rank: h.hotListRank }))
        })
      });
    }

    return {
      timestamp: new Date(),
      totalAssetsScanned: allAssets.length,
      qualifiedHotListCount: hotListQualified.length,
      hotList: hotListQualified
    };
  }
}
