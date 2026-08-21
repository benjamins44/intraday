-- ====================================================================
-- Script SQL pour corriger les symboles incompatibles avec Yahoo Finance
-- Yahoo Finance utilise des tirets '-' au lieu de points '.' pour les classes d'actions US (ex: BRK-B au lieu de BRK.B)
-- Le ticker Trading 212 (t212_ticker) reste intact pour l'exécution d'ordres.
-- ====================================================================

BEGIN TRANSACTION;

-- Correction de Berkshire Hathaway Class B
UPDATE assets 
SET symbol = 'BRK-B', updated_at = CURRENT_TIMESTAMP 
WHERE symbol = 'BRK.B';

-- Correction de Brown-Forman Class B
UPDATE assets 
SET symbol = 'BF-B', updated_at = CURRENT_TIMESTAMP 
WHERE symbol = 'BF.B';

-- Règle générique pour tout autre symbole contenant un point dans la table assets
UPDATE assets 
SET symbol = REPLACE(symbol, '.', '-'), updated_at = CURRENT_TIMESTAMP 
WHERE symbol LIKE '%.%';

-- Correction éventuelle dans la table positions si existante
UPDATE positions 
SET symbol = REPLACE(symbol, '.', '-') 
WHERE symbol LIKE '%.%';

COMMIT;
