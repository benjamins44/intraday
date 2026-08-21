# INTRADAY-API
### Moteur de Trading Intraday John Carter (Architecture Hexagonale)

Projet API complet en **TypeScript**, **Express**, **SQLite (better-sqlite3)** et **node-cron** implémentant la stratégie de trading intraday de John Carter (*Mastering the Trade*).

---

## 🏛️ ARCHITECTURE HEXAGONALE (Ports & Adapters)

```
intraday-api/
├── src/
│   ├── config/
│   │   └── env.config.ts                      # Paramètres typés (.env)
│   ├── domain/                                # COEUR DE MÉTIER PUR (Indépendant de tout framework)
│   │   ├── models/
│   │   │   ├── asset.entity.ts                # Entité Actif
│   │   │   ├── position.entity.ts             # Entité Position & Brackets
│   │   │   ├── market-breadth.entity.ts       # $TICK, $ADD, $TRIN, SPY
│   │   │   └── scoring.entity.ts              # CarterScore 0-100
│   │   ├── services/
│   │   │   └── carter-indicators.service.ts   # Calculs TTM Squeeze, ATR, Momentum, Scoring
│   │   └── ports/
│   │       ├── in/                            # Use Cases (Driving Ports)
│   │       │   ├── execute-cycle.usecase.port.ts
│   │       │   ├── generate-hotlist.usecase.port.ts
│   │       │   ├── manage-positions.usecase.port.ts
│   │       │   └── manage-assets.usecase.port.ts
│   │       └── out/                           # Driven Ports
│   │           ├── asset-repository.port.ts
│   │           ├── position-repository.port.ts
│   │           ├── market-data.port.ts
│   │           └── execution-broker.port.ts
│   ├── application/                           # CAS D'UTILISATION (Orchestration)
│   │   └── usecases/
│   │       ├── execute-intraday-cycle.usecase.ts  # Boucle 1-min & Square-off 15h45
│   │       ├── generate-hotlist.usecase.ts        # Screener pré-marché (RVOL, Squeeze 60m)
│   │       ├── manage-positions.usecase.ts        # Gestion des positions & Portefeuille
│   │       └── manage-assets.usecase.ts           # CRUD & Seed des 1000 actions
│   └── infrastructure/                        # ADAPTATEURS TECHNIQUES
│       ├── database/
│       │   ├── sqlite.connection.ts           # SQLite WAL & schéma automatique
│       │   └── init-db.ts                     # Script de seed
│       └── adapters/
│           ├── inbound/
│           │   ├── http/                      # Express REST API (Routes & Server)
│           │   │   ├── server.ts
│           │   │   └── routes/
│           │   │       ├── asset.routes.ts
│           │   │       ├── position.routes.ts
│           │   │       └── engine.routes.ts
│           │   └── cron/                      # node-cron (Cycles automatiques)
│           │       └── intraday-scheduler.adapter.ts
│           └── outbound/
│               ├── database/                  # Repositories SQLite
│               │   ├── sqlite-asset.repository.ts
│               │   └── sqlite-position.repository.ts
│               ├── market-data/               # Flux hybride TradingView WS & Yahoo
│               │   └── hybrid-market-data.adapter.ts
│               └── broker/                    # Courtier simulé (Paper Trading 40% Cash)
│                   └── simulated-execution.adapter.ts
```

---

## ⚡ RÈGLES DE TRADING IMPLÉMENTÉES

1. **Univers d'actifs :** Stocké en base de données SQLite (table `assets`).
2. **Screener Hot List :** À 15h15 Paris (09h15 EST), filtre les meilleures actions (`Volume 50j > 1M`, `Prix > 10$`, `RVOL >= 1.5`, `Squeeze 60m = 'R'`).
3. **Boucle Intraday 1-Minute :**
   - Évalue la largeur de marché (`USI:TICK`, `USI:ADD`, `USI:TRIN`).
   - Calcule le score Carter $(0-100)$ sur la Hot List.
   - Si $\text{Score} \ge 80$ et positions ouvertes $< 2$ :
     - **Mise de 40% du cash disponible** par position.
     - Placement automatique du **Stop-Loss Hard** et du **Take-Profit (+2 ATR)**.
4. **Recyclage du cash :** Dès qu'une position est fermée (TP, SL ou Invalidation), le cash ($40\% \pm \text{PnL}$) est instantanément réinjecté dans le portefeuille pour les cycles suivants.
5. **Square-Off à 21h45 Paris (15h45 EST) :** Liquidation automatique au marché de toutes les positions en cours.

---

## 🚀 DÉMARRAGE ET UTILISATION

### 1. Installation & Initialisation de la BDD
```bash
cd intraday-api
npm install
npm run seed
```

### 2. Lancement du Serveur & du Cron
```bash
npm run dev
```

### 3. Endpoints REST Disponibles

#### Actifs & Hot List
- `GET /api/assets` : Liste de tous les actifs de la base.
- `GET /api/assets/hotlist` : Liste des 50 actions de la Hot List courante.
- `POST /api/assets/seed` : Injection des actions leaders du marché US.

#### Positions & Portefeuille
- `GET /api/positions` : Liste des positions (`?status=OPEN` ou `?status=CLOSED`).
- `GET /api/positions/summary` : Bilan du capital, cash disponible, cash investi et P&L total.
- `POST /api/positions/:id/close` : Clôture manuelle d'une position.
- `POST /api/positions/square-off` : Liquidation d'urgence de toutes les positions.

#### Moteur de Trading
- `POST /api/engine/run-cycle` : Déclenche manuellement un cycle 1-minute de scoring & exécution.
- `POST /api/engine/generate-hotlist` : Déclenche le screener pré-marché.
- `GET /api/engine/market-breadth` : Récupère les métriques en direct de $TICK, $ADD et $TRIN.
