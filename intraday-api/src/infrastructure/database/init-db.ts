import { getDatabase } from './sqlite.connection';
import { SqliteAssetRepository } from '../adapters/outbound/database/sqlite-asset.repository';
import { SqlitePositionRepository } from '../adapters/outbound/database/sqlite-position.repository';
import { ManageAssetsUseCase } from '../../application/usecases/manage-assets.usecase';

async function initAndSeed() {
  console.log('🚀 Initialisation de la base SQLite et injection des 1000 actifs sélectionnés...');

  getDatabase(); // Déclenche la création des tables et de portfolio
  const assetRepo = new SqliteAssetRepository();
  const positionRepo = new SqlitePositionRepository();
  const manageAssets = new ManageAssetsUseCase(assetRepo);

  // 1. Insertion des 1000 assets depuis actions/actifs1000.txt
  const result = await manageAssets.seedTopUSAssets();
  console.log(`✅ ${result.insertedCount} actifs injectés avec succès (Total en base : ${result.totalCount}).`);

  // 2. Vérification de la Hot List
  const hotList = await assetRepo.getHotList();
  console.log(`🔥 Hot List active initiale : ${hotList.length} actions.`);

  // 3. Portefeuille
  const portfolio = await positionRepo.getPortfolioCash();
  console.log(`💰 Portefeuille initialisé :`, portfolio);

  console.log('🎉 Base SQLite prête à l\'emploi avec les 1000 actifs !');
  process.exit(0);
}

initAndSeed().catch((err) => {
  console.error('❌ Erreur lors de l\'initialisation :', err);
  process.exit(1);
});
