const WebSocket = require('ws');
import crypto from 'crypto';

export class PersistentTradingViewStream {
  private static instance: PersistentTradingViewStream | null = null;
  private ws: any = null;
  private isConnected = false;
  private isConnecting = false;

  private quoteSessionId: string;

  // Buffer mémoire des prix / stats instantanées par symbole (ex: "USI:TICK", "NASDAQ:AAPL")
  private quoteCache = new Map<string, { price: number; volume: number; change: number }>();

  // Abonnements actifs
  private subscribedSymbols = new Set<string>();

  private constructor() {
    this.quoteSessionId = `qs_${crypto.randomBytes(6).toString('hex')}`;
  }

  public static getInstance(): PersistentTradingViewStream {
    if (!PersistentTradingViewStream.instance) {
      PersistentTradingViewStream.instance = new PersistentTradingViewStream();
    }
    return PersistentTradingViewStream.instance;
  }

  private encodeTVMessage(msg: any): string {
    const str = JSON.stringify(msg);
    return `~m~${str.length}~m~${str}`;
  }

  public async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            Origin: 'https://www.tradingview.com',
            Referer: 'https://www.tradingview.com/'
          }
        });

        this.ws.on('open', () => {
          this.isConnected = true;
          this.isConnecting = false;
          console.log('[TV Stream] 🟢 Connexion WebSocket unique permanente établie avec TradingView.');

          // Initialisation des sessions
          this.send({ m: 'set_auth_token', p: ['unauthorized_user_token'] });
          this.send({ m: 'quote_create_session', p: [this.quoteSessionId] });
          this.send({
            m: 'quote_set_fields',
            p: [this.quoteSessionId, 'lp', 'volume', 'ch', 'chp', 'open_price', 'high_price', 'low_price', 'prev_close_price']
          });

          // Réabonnement des symboles existants
          if (this.subscribedSymbols.size > 0) {
            const symbolsArray = Array.from(this.subscribedSymbols);
            this.send({ m: 'quote_add_symbols', p: [this.quoteSessionId, ...symbolsArray] });
          }

          resolve();
        });

        this.ws.on('message', (data: any) => this.handleMessage(data));

        this.ws.on('error', (err: any) => {
          console.warn(`[TV Stream] ⚠️ Erreur socket : ${err.message || err}`);
        });

        this.ws.on('close', () => {
          console.warn('[TV Stream] 🔌 Déconnexion du flux WebSocket TradingView. Tentative de reconnexion dans 5s...');
          this.isConnected = false;
          this.isConnecting = false;
          setTimeout(() => this.connect(), 5000);
        });
      } catch (err) {
        this.isConnecting = false;
        resolve();
      }
    });
  }

  private send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(this.encodeTVMessage(msg));
    }
  }

  private handleMessage(data: any) {
    const text = data.toString();

    // Gestion du Ping-Pong TradingView pour garder la connexion vivante
    if (text.startsWith('~m~') && text.includes('~h~')) {
      const pings = text.match(/~m~\d+~m~~h~\d+/g);
      if (pings) {
        pings.forEach((p: string) => {
          const num = p.split('~h~')[1];
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(`~m~${num.length + 4}~m~~h~${num}`);
          }
        });
      }
      return;
    }

    // Décodage des paquets ~m~len~m~JSON
    const parts = text.split(/~m~\d+~m~/).filter(Boolean);
    for (const part of parts) {
      try {
        const msg = JSON.parse(part);

        // Mises à jour de cotation en direct (quote_completed / qsd)
        if (msg.m === 'qsd') {
          const payload = msg.p?.[1];
          if (payload && payload.n && payload.v) {
            const symbol = payload.n;
            const values = payload.v;
            const current = this.quoteCache.get(symbol) || { price: 0, volume: 0, change: 0 };

            if (values.lp !== undefined) current.price = values.lp;
            if (values.volume !== undefined) current.volume = values.volume;
            if (values.ch !== undefined) current.change = values.ch;

            this.quoteCache.set(symbol, current);
          }
        }
      } catch {}
    }
  }

  /**
   * Abonnement groupé à une liste de symboles sur la session unique
   */
  public subscribeSymbols(symbolsWithExchange: string[]) {
    const toAdd: string[] = [];
    for (const s of symbolsWithExchange) {
      if (!this.subscribedSymbols.has(s)) {
        this.subscribedSymbols.add(s);
        toAdd.push(s);
      }
    }

    if (toAdd.length > 0 && this.isConnected) {
      this.send({ m: 'quote_add_symbols', p: [this.quoteSessionId, ...toAdd] });
      console.log(`[TV Stream] 📡 Abonnement groupé à ${toAdd.length} symboles sur le WebSocket unique.`);
    }
  }

  public getCachedQuote(symbolWithExchange: string) {
    return this.quoteCache.get(symbolWithExchange);
  }
}
