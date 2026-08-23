import { spawnSync } from 'child_process';
import { AiAdvisorPort } from '../../../../domain/ports/out/ai-advisor.port';
import {
  PreOrderAiInput,
  PreOrderAiDecision,
  PostMortemAiInput,
  PostMortemAiResult,
  WeeklyStatsInput,
  WeeklyDigestResult
} from '../../../../domain/models/ai-feedback.entity';
import { config } from '../../../../config/env.config';

export class AntigravityGeminiAdapter implements AiAdvisorPort {
  private readonly agyBinPath: string;

  constructor(agyBinPath = config.agyBinPath || 'agy') {
    this.agyBinPath = agyBinPath;
  }

  private executeAgyPrompt(prompt: string, schema: any, timeoutMs = 25000): string {
    const schemaInstruction = `\n\nCRITICAL: Renvoyez uniquement un bloc de code JSON brut respectant exactement le schéma suivant :\n${JSON.stringify(
      schema,
      null,
      2
    )}\nNe mettez aucun texte d'introduction ni de conclusion, pas de markdown (comme \`\`\`json), renvoyez uniquement le JSON brut.`;
    const fullPrompt = prompt + schemaInstruction;

    const result = spawnSync(
      this.agyBinPath,
      ['--dangerously-skip-permissions', '--mode', 'plan', '-p', fullPrompt],
      { encoding: 'utf-8', timeout: timeoutMs }
    );

    if (result.error) {
      throw new Error(`[AntigravityGeminiAdapter] Failed to execute agy CLI: ${result.error.message}`);
    }

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    if (result.status !== 0) {
      throw new Error(
        `[AntigravityGeminiAdapter] agy CLI exited with code ${result.status}, signal ${result.signal}. ` +
          `Stdout: ${stdout || 'None'}. Stderr: ${stderr || 'None'}`
      );
    }

    if (!stdout) {
      throw new Error(
        `[AntigravityGeminiAdapter] agy CLI returned empty stdout. ` +
          `Exit code: ${result.status}, signal ${result.signal}. Stderr: ${stderr || 'None'}`
      );
    }

    return stdout;
  }

  private parseResponseJson<T>(rawText: string): T {
    let cleanText = rawText.trim();

    // Strip markdown code block wrappers if present (e.g. ```json ... ``` or ``` ...)
    if (cleanText.includes('```')) {
      const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) {
        cleanText = match[1].trim();
      }
    }

    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`[AntigravityGeminiAdapter] Failed to find valid JSON block in model response: ${rawText}`);
    }
    const jsonStr = cleanText.substring(start, end + 1);

    try {
      return JSON.parse(jsonStr) as T;
    } catch (parseError: any) {
      try {
        const sanitized = jsonStr.replace(/[\r\n\t]/g, ' ');
        return JSON.parse(sanitized) as T;
      } catch {
        console.error(`[AntigravityGeminiAdapter] Standard JSON.parse failed. Raw JSON block:\n${jsonStr}`);
        throw new Error(`[AntigravityGeminiAdapter] JSON Parse Error: ${parseError.message}. Content was: ${jsonStr}`);
      }
    }
  }

  /**
   * Pilier 1 : Filtre Pré-Ordre ("Second Opinion" Contextuel & RAG Ciblé)
   * Timeout court pour l'intraday (1.5s - 2.5s) avec fallback direct en cas de dépassement.
   */
  async evaluatePreOrder(input: PreOrderAiInput): Promise<PreOrderAiDecision> {
    const startTime = Date.now();

    const newsText =
      input.recentNewsHeadlines && input.recentNewsHeadlines.length > 0
        ? input.recentNewsHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
        : 'Aucune actualité défavorable majeure détectée.';

    const lessonsText =
      input.recentFeedbackLessons && input.recentFeedbackLessons.length > 0
        ? input.recentFeedbackLessons.map((l, i) => `- ${l}`).join('\n')
        : 'Aucun échec récent mémorisé pour ce contexte.';

    const prompt = `
Tu es un gestionnaire de risque senior spécialisé dans le trading intraday d'actions US (méthodologie John Carter).
Un signal technique d'achat (LONG) vient d'être validé par l'algorithme sur l'action suivante.

DONNÉES DU SETUP TECHNIQUE :
- Symbole : ${input.symbol}
- Cours actuel : ${input.currentPrice}$
- Heure EST : ${input.currentTimeEST}
- TTM Squeeze : ${input.squeezeState} (Momentum 5m: ${input.momentum5m.toFixed(4)})
- Anchor 60m : ${input.anchorTrend} (Momentum 60m: ${input.momentum60m.toFixed(4)})
- Volume Relatif (RVOL) : ${input.rvol.toFixed(2)}
- Niveaux : SL = ${input.stopLoss}$, TP1 = ${input.takeProfit1}$ (Ratio R/R : ${input.riskRewardRatio}R)
- Contexte Marché : $ADD = ${input.nyseAdd}, $TICK = ${input.nyseTick}

TITRES DES DERNIÈRES ACTUALITÉS DU JOUR SUR ${input.symbol} :
${newsText}

MÉMOIRE DES RETOURS D'EXPÉRIENCE & FEEDBACKS RÉCENTS (Dernières leçons apprises) :
${lessonsText}

CONSIGNES DE DÉCISION :
1. Confrontation avec le Feedback : Vérifie si ce trade reproduit un schéma d'échec identifié dans la mémoire des feedbacks récents.
2. Risque Qualitatif / News : Évalue si l'action présente un piège (OPA bloquante, dilution imminente, décision binaire biotech).
3. Décision finale : Approuve l'ordre uniquement si le setup est sain et aligné avec l'historique d'apprentissage.
`;

    const schema = {
      type: 'object',
      properties: {
        approve: { type: 'boolean', description: 'true pour autoriser l ordre, false pour l annuler' },
        confidence: { type: 'number', description: 'note de 0.0 à 1.0' },
        riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        matchedPastFailurePattern: { type: 'boolean', description: 'true si ce setup ressemble à un échec passé' },
        reason: { type: 'string', description: 'Explication synthétique justifiant la décision' }
      },
      required: ['approve', 'confidence', 'riskLevel', 'matchedPastFailurePattern', 'reason']
    };

    try {
      const raw = this.executeAgyPrompt(prompt, schema, 3000);
      const parsed = this.parseResponseJson<any>(raw);
      const latencyMs = Date.now() - startTime;

      return {
        symbol: input.symbol,
        approve: Boolean(parsed.approve),
        confidence: Number(parsed.confidence ?? 0.9),
        riskLevel: parsed.riskLevel || 'LOW',
        matchedPastFailurePattern: Boolean(parsed.matchedPastFailurePattern),
        reason: String(parsed.reason || 'Approuvé par filtre IA.'),
        latencyMs
      };
    } catch (err: any) {
      console.warn(`[AntigravityGeminiAdapter] ⚠️ Timeout ou indisponibilité IA pré-ordre (${err.message}) -> Fallback APPROVE.`);
      return {
        symbol: input.symbol,
        approve: true,
        confidence: 0.8,
        riskLevel: 'LOW',
        matchedPastFailurePattern: false,
        reason: 'Fallback automatique (indisponibilité temporaire IA / timeout).',
        latencyMs: Date.now() - startTime
      };
    }
  }

  /**
   * Pilier 2 : Le Coach Quant Post-Mortem (Exécuté dès la clôture d'une position)
   */
  async analyzeTradePostMortem(input: PostMortemAiInput): Promise<PostMortemAiResult> {
    const prompt = `
Tu es un ingénieur quantitatif et coach de trading expert de la méthode John Carter (« Mastering the Trade »).
Analyse l'exécution de la position suivante qui vient d'être clôturée.

DONNÉES DU TRADE :
- Actif : ${input.symbol} (Côté : ${input.side})
- Entrée : ${input.entryPrice}$ à ${input.entryTime}
- Sortie : ${input.exitPrice}$ à ${input.exitTime} (Durée : ${input.durationMinutes} min)
- Motif de Sortie : ${input.exitReason} (Ex: STOP_LOSS, TAKE_PROFIT_1, SQUARE_OFF, TRAILING_STOP)
- P&L Net : ${input.pnlDollar}$ (${input.pnlPercent}%)
- Prix Plus Haut atteint pendant le trade : ${input.maxPriceReached}$ (P&L Max latent : ${input.maxGainPercent}%)
- Prix Plus Bas atteint pendant le trade : ${input.minPriceReached}$
- Stop-Loss Initial : ${input.initialStopLoss}$ | Stop-Loss Final : ${input.finalStopLoss}$
- Comportement du Marché ($TICK / $ADD) pendant le trade : ${input.marketBreadthTrend}
- Secteur : ${input.sector || 'Général'}

OBJECTIFS D'ANALYSE :
1. Diagnostic d'entrée : Le timing était-il optimal ou tardif par rapport au Squeeze ?
2. Diagnostic de sortie : La sortie était-elle justifiée ou le trade a-t-il été étouffé prématurément par le Trailing Stop ?
3. Règle mémorisable : Rédige une leçon concise (1 phrase) prête à être injectée dans la mémoire du filtre pré-ordre pour les futurs trades.
`;

    const schema = {
      type: 'object',
      properties: {
        entryQuality: { type: 'string', enum: ['GOOD', 'LATE', 'CHASING'] },
        exitQuality: { type: 'string', enum: ['OPTIMAL', 'PREMATURE_STOP', 'LATE'] },
        keyLesson: { type: 'string', description: 'Règle concise à mémoriser pour les prochains scans' },
        suggestedRuleUpdate: {
          type: 'object',
          properties: {
            targetParameter: { type: 'string' },
            proposedValue: { type: 'string' }
          }
        }
      },
      required: ['entryQuality', 'exitQuality', 'keyLesson']
    };

    const raw = this.executeAgyPrompt(prompt, schema, 25000);
    return this.parseResponseJson<PostMortemAiResult>(raw);
  }

  /**
   * Pilier 3 : Synthèse & Optimisation Hebdomadaire
   */
  async generateWeeklyDigest(input: WeeklyStatsInput): Promise<WeeklyDigestResult> {
    const prompt = `
Tu es l'architecte en chef d'un système de trading algorithmique intraday basé sur John Carter.
Voici le récapitulatif des transactions exécutées cette semaine :

STATISTIQUES GLOBALES (${input.startDate} au ${input.endDate}) :
- Nombre de trades : ${input.totalTrades}
- Taux de réussite (Win Rate) : ${input.winRate.toFixed(1)}%
- Profit Factor : ${input.profitFactor.toFixed(2)}
- Gain Moyen / Perte Moyenne : ${input.avgWin.toFixed(2)}$ / ${input.avgLoss.toFixed(2)}$
- P&L Net Total : ${input.totalPnl.toFixed(2)}$

RÉPARTITION PAR CRÉNEAU HORAIRE (EST) :
- 09h30 - 10h30 (Open) : ${input.openWinRate.toFixed(1)}% win (P&L: ${input.openPnl.toFixed(2)}$)
- 10h30 - 12h00 (Morning) : ${input.morningWinRate.toFixed(1)}% win (P&L: ${input.morningPnl.toFixed(2)}$)
- 12h00 - 13h30 (Lunch Chop Zone) : ${input.lunchWinRate.toFixed(1)}% win (P&L: ${input.lunchPnl.toFixed(2)}$)
- 13h30 - 15h45 (Afternoon / Close) : ${input.afternoonWinRate.toFixed(1)}% win (P&L: ${input.afternoonPnl.toFixed(2)}$)

DONNÉES BRUTES DES TRADES :
${JSON.stringify(input.tradesSummary, null, 2)}

MISSION :
1. Identifie les 2 plus grands points de fuite de capital.
2. Identifie les configurations les plus profitables de la semaine.
3. Rédige un rapport de synthèse clair en markdown et propose des ajustements pour les constantes de configuration.
`;

    const schema = {
      type: 'object',
      properties: {
        reportMarkdown: { type: 'string', description: 'Rapport complet en markdown avec sections et puces' },
        keyLessons: { type: 'array', items: { type: 'string' } },
        suggestedConfigUpdates: { type: 'object' }
      },
      required: ['reportMarkdown', 'keyLessons']
    };

    const raw = this.executeAgyPrompt(prompt, schema, 35000);
    return this.parseResponseJson<WeeklyDigestResult>(raw);
  }
}
