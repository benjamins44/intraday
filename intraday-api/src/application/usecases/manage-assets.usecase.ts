import { ManageAssetsUseCasePort } from '../../domain/ports/in/manage-assets.usecase.port';
import { AssetRepositoryPort } from '../../domain/ports/out/asset-repository.port';
import { Asset } from '../../domain/models/asset.entity';

export const DEFAULT_TOP_US_STOCKS: Omit<Asset, 'id'>[] = [
  // Tech & Mega-Caps
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology', isActive: true, isInHotList: true, hotListRank: 1 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', sector: 'Technology', isActive: true, isInHotList: true, hotListRank: 2 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: true, hotListRank: 3 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', sector: 'Consumer Discretionary', isActive: true, isInHotList: true, hotListRank: 4 },
  { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', exchange: 'NASDAQ', sector: 'Communication Services', isActive: true, isInHotList: true, hotListRank: 5 },
  { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ', sector: 'Communication Services', isActive: true, isInHotList: true, hotListRank: 6 },
  { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', sector: 'Consumer Discretionary', isActive: true, isInHotList: true, hotListRank: 7 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: true, hotListRank: 8 },
  { symbol: 'AVGO', name: 'Broadcom Inc.', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: true, hotListRank: 9 },
  { symbol: 'NFLX', name: 'Netflix Inc.', exchange: 'NASDAQ', sector: 'Communication Services', isActive: true, isInHotList: true, hotListRank: 10 },
  
  // Semiconductors & AI
  { symbol: 'QCOM', name: 'QUALCOMM Incorporated', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'INTC', name: 'Intel Corporation', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'MU', name: 'Micron Technology', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'ARM', name: 'Arm Holdings plc', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing', exchange: 'NYSE', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'ASML', name: 'ASML Holding N.V.', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'AMAT', name: 'Applied Materials Inc.', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },
  { symbol: 'LRCX', name: 'Lam Research Corp.', exchange: 'NASDAQ', sector: 'Semiconductors', isActive: true, isInHotList: false },

  // Growth, Cloud & Software
  { symbol: 'PLTR', name: 'Palantir Technologies', exchange: 'NYSE', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'CRM', name: 'Salesforce Inc.', exchange: 'NYSE', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'ORCL', name: 'Oracle Corporation', exchange: 'NYSE', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'ADBE', name: 'Adobe Inc.', exchange: 'NASDAQ', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'NOW', name: 'ServiceNow Inc.', exchange: 'NYSE', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'SNOW', name: 'Snowflake Inc.', exchange: 'NYSE', sector: 'Software', isActive: true, isInHotList: false },
  { symbol: 'PANW', name: 'Palo Alto Networks', exchange: 'NASDAQ', sector: 'Cybersecurity', isActive: true, isInHotList: false },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', exchange: 'NASDAQ', sector: 'Cybersecurity', isActive: true, isInHotList: false },

  // Financial & Payment
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },
  { symbol: 'BAC', name: 'Bank of America Corp.', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc.', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },
  { symbol: 'MS', name: 'Morgan Stanley', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },
  { symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },
  { symbol: 'MA', name: 'Mastercard Inc.', exchange: 'NYSE', sector: 'Financials', isActive: true, isInHotList: false },

  // Healthcare & Biotech
  { symbol: 'LLY', name: 'Eli Lilly and Company', exchange: 'NYSE', sector: 'Healthcare', isActive: true, isInHotList: false },
  { symbol: 'UNH', name: 'UnitedHealth Group', exchange: 'NYSE', sector: 'Healthcare', isActive: true, isInHotList: false },
  { symbol: 'JNJ', name: 'Johnson & Johnson', exchange: 'NYSE', sector: 'Healthcare', isActive: true, isInHotList: false },
  { symbol: 'ABBV', name: 'AbbVie Inc.', exchange: 'NYSE', sector: 'Healthcare', isActive: true, isInHotList: false },

  // Energy & Industrials
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', exchange: 'NYSE', sector: 'Energy', isActive: true, isInHotList: false },
  { symbol: 'CVX', name: 'Chevron Corporation', exchange: 'NYSE', sector: 'Energy', isActive: true, isInHotList: false },
  { symbol: 'CAT', name: 'Caterpillar Inc.', exchange: 'NYSE', sector: 'Industrials', isActive: true, isInHotList: false },
  { symbol: 'BA', name: 'Boeing Company', exchange: 'NYSE', sector: 'Industrials', isActive: true, isInHotList: false },
  { symbol: 'GE', name: 'GE Aerospace', exchange: 'NYSE', sector: 'Industrials', isActive: true, isInHotList: false },

  // Consumer & Retail
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', sector: 'Consumer Staples', isActive: true, isInHotList: false },
  { symbol: 'COST', name: 'Costco Wholesale Corp.', exchange: 'NASDAQ', sector: 'Consumer Staples', isActive: true, isInHotList: false },
  { symbol: 'HD', name: 'The Home Depot Inc.', exchange: 'NYSE', sector: 'Consumer Discretionary', isActive: true, isInHotList: false },
  { symbol: 'NKE', name: 'NIKE Inc.', exchange: 'NYSE', sector: 'Consumer Discretionary', isActive: true, isInHotList: false }
];

export class ManageAssetsUseCase implements ManageAssetsUseCasePort {
  constructor(private assetRepo: AssetRepositoryPort) {}

  async getAllAssets(onlyActive = true): Promise<Asset[]> {
    return this.assetRepo.findAll(onlyActive);
  }

  async getHotListAssets(): Promise<Asset[]> {
    return this.assetRepo.getHotList();
  }

  async addAsset(asset: Omit<Asset, 'id'>): Promise<Asset> {
    return this.assetRepo.save(asset as Asset);
  }

  async seedTopUSAssets(): Promise<{ insertedCount: number; totalCount: number }> {
    const fs = await import('fs');
    const path = await import('path');

    // Chemin du fichier sp500.csv
    let sp500FilePath = path.resolve(__dirname, '../../../../actions/sp500.csv');
    if (!fs.existsSync(sp500FilePath)) {
      sp500FilePath = path.resolve(__dirname, '../../../actions/sp500.csv');
    }

    // Chargement du catalogue Trading 212
    const t212InstrumentsPath = path.resolve(__dirname, '../../../t212_instruments.json');
    const t212Map = new Map<string, string>();
    if (fs.existsSync(t212InstrumentsPath)) {
      try {
        const rawT212 = JSON.parse(fs.readFileSync(t212InstrumentsPath, 'utf8')) as any[];
        for (const inst of rawT212) {
          if (inst.ticker) {
            const cleanSym = inst.ticker.split('_')[0].toUpperCase();
            if (inst.currencyCode === 'USD' || inst.ticker.endsWith('_US_EQ')) {
              t212Map.set(cleanSym, inst.ticker);
            } else if (!t212Map.has(cleanSym)) {
              t212Map.set(cleanSym, inst.ticker);
            }
          }
        }
      } catch (err) {
        console.warn('[Seed] Impossible de charger t212_instruments.json :', err);
      }
    }

    const assetsToInsert: Omit<Asset, 'id'>[] = [];

    if (fs.existsSync(sp500FilePath)) {
      const content = fs.readFileSync(sp500FilePath, 'utf8');
      const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

      // Saut de l'en-tête (ligne 0)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('#')) continue;

        // Parsing CSV simple avec gestion des guillemets
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (parts.length >= 3) {
          const rawSymbol = parts[0].replace(/"/g, '').trim().toUpperCase();
          const symbol = rawSymbol.replace(/\./g, '-'); // ex: BRK.B -> BRK-B pour Yahoo
          const name = parts[1].replace(/"/g, '').trim();
          const sector = parts[2].replace(/"/g, '').trim();

          if (symbol && name) {
            const known = DEFAULT_TOP_US_STOCKS.find((s) => s.symbol === symbol);
            let exchange = known?.exchange;
            if (!exchange) {
              exchange = symbol.length <= 3 ? 'NYSE' : 'NASDAQ';
            }

            const t212Ticker = t212Map.get(symbol) || `${symbol}_US_EQ`;

            assetsToInsert.push({
              symbol,
              name,
              exchange,
              sector,
              t212Ticker,
              isActive: true,
              isInHotList: i <= 50,
              hotListRank: i <= 50 ? i : undefined
            });
          }
        }
      }
    }

    const finalAssets = assetsToInsert.length > 0 ? assetsToInsert : DEFAULT_TOP_US_STOCKS;
    
    // Nettoyage complet pour garantir que seules les actions S&P 500 sont présentes
    await this.assetRepo.deleteAll();
    await this.assetRepo.saveBulk(finalAssets as Asset[]);
    const total = await this.assetRepo.count();

    console.log(`[Seed] 🏛️ Univers S&P 500 initialisé avec succès : ${finalAssets.length} leaders institutionnels insérés.`);
    return { insertedCount: finalAssets.length, totalCount: total };
  }
}
