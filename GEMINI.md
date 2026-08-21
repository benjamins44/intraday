Tu es un ingénieur expert en trading quantitatif et en architecture logicielle. Ton objectif est de concevoir et coder un système complet de trading intraday basé strictement sur la méthodologie de John Carter (décrite dans « Mastering the Trade »).

---

### 1. PHILOSOPHIE & PRINCIPES DIRECTEURS
Le système repose sur la piégeage de liquidité et la liquidation forcée.
- **Règle absolue :** Ne jamais utiliser d'indicateurs retardés isolés sur un seul actif comme uniques déclencheurs.
- **Indicateurs clés requis :**
  1. **TTM Squeeze :** Compression de volatilité (Bandes de Bollinger 20, 2 à l'intérieur des Canaux de Keltner 20, 1.5).
  2. **NYSE/NASDAQ $TICK :** Pression d'exécution institutionnelle (Extrêmes à ±1000).
  3. **NYSE/NASDAQ $ADD :** Largeur de marché Advance/Decline pour identifier le régime (Tendance vs Range).
  4. **Anchor Charts :** Alignement avec la tendance d'unité de temps supérieure (60 min / Quotidien).

---

### 2. INFRASTRUCTURE & FLUX DE DONNÉES
- **API Données & Routage :** Intégration via Interactive Brokers (`ib-async` / TWS Gateway) ou Tradier API (REST + WebSockets). Les API à prix seuls (ex. Yahoo Finance) et les scrapers instables sont proscrits pour les flux temps réel $TICK/$ADD.
- **Moteur d'exécution :** Cron planifié à la minute (`* * * * *`) pour la boucle de vérification, combiné à une gestion asynchrone des événements d'ordres (WebSockets pour les exécutions et stops d'urgence).

---

### 3. ALGORITHME DE L'EXÉCUTEUR (INTRADAY CRON - 1 MINUTE)

À chaque exécution de la boucle :

#### A. Contrôle de Sécurité & Clôture Temporisée
1. Vérifier si le marché US est ouvert. Si fermé -> Terminer.
2. Si `Heure >= 15h45 EST` (15 min avant clôture) :
   - Liquider toutes les positions intraday ouvertes (*Square-off*).
   - Annuler tous les ordres en attente.
   - Logger la fin de journée et fermer l'exécution.

#### B. Synchronisation d'État
1. Récupérer les dernières bougies OHLCV terminées.
2. Récupérer les valeurs courantes des indices de largeur de marché ($TICK, $ADD).
3. Interroger l'API du courtier pour vérifier la concordance de l'état des positions réelles avec la base de données locale.

#### C. Branche 1 : Gestion des Positions Ouvertes
Si une position est active :
1. Évaluer la condition d'invalidation temporelle/structurelle :
   - Clôture d'une bougie 60 min au-delà de la ligne d'invalidation.
   - Inversion du momentum TTM Squeeze.
2. Si la condition est vérifiée -> Transmettre un ordre de clôture au marché immédiatement.
3. Si le Stop-Loss ou Take-Profit (ordres OCO gérés par le courtier) a été exécuté -> Mettre à jour la base de données locale et libérer le registre.

#### D. Branche 2 : Détection des Signaux d'Entrée (Si 0 position)
Évaluer la présence simultanée de signaux :

1. **Setup TTM Squeeze :**
   - Détecter la sortie d'une zone de compression (Bollinger sort de Keltner).
   - Valider la direction via l'oscillateur de momentum aligné avec l'Anchor Chart 60 min.

2. **Setup $TICK Fade :**
   - Détecter un pic extrême de $TICK (>= +1000 pour Short, <= -1000 pour Long).
   - **Filtre obligatoire $ADD :** Le $ADD doit être neutre/horizontal (marché en range). Interdiction de contre-tendance si le $ADD indique une journée de Tendance Forte ($ADD > +1500 ou < -1500).

3. **Setup Divergence (« Fake Orgasm ») :**
   - Nouveau plus haut/bas de l'actif combiné à une divergence nette du RSI(7) et une baisse de volume >= 50 %.

#### E. Calcul de la Taille de Position & Risque
Si un signal $S \in \{-1, 1\}$ est validé :

1. **Calcul du Stop-Loss ($SL$) :** Placer le $SL$ derrière le dernier creux/sommet pivot ou le niveau Keltner opposé.
2. **Dimensionnement selon le risque du compte :**
   $$N_{\text{risque}} = \frac{\text{Capital} \times \text{Risque Max (1-2\%)}}{\lvert \text{Prix Entrée} - \text{Prix Stop} \rvert}$$
3. **Plafond Utilisateur Strict :**
   L'utilisateur fournit un paramètre `N_max_user` (taille de position maximale autorisée en unités ou capital engagé).
   $$N_{\text{effectif}} = \min(N_{\text{risque}}, N_{\text{max\_user}})$$
4. Si $N_{\text{effectif}} > 0$ :
   - Envoyer l'ordre d'entrée au marché ou limite ajustable.
   - Rattacher immédiatement les ordres bracketing (Stop-Loss Hard + Take-Profit).
   - Enregistrer la transaction en base de données locale.

---

### 4. ATTENDUS DU CODE / IMPLÉMENTATION
1. Fournis une architecture orientée objet propre (ex. Python avec `ib-async` ou Node.js/TypeScript avec `tradier`).
2. Sépare clairement le module d'acquisition de données, le moteur de calcul des indicateurs, le module de stratégie, et le gestionnaire d'ordres.
3. Inclus la gestion des erreurs (reconnexion WebSocket, pannes API, écarts de synchronisation).
4. Fournis un fichier de configuration contenant les paramètres utilisateur (`N_max_user`, pourcentage de risque, seuils $TICK, identifiants API).
