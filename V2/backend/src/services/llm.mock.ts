import type { LlmCompletion, LlmService } from './llm';

/**
 * Agent-aware deterministic mock. Parses the agent marker from the prompt and
 * generates plausible specialist-specific outputs so the UI has varied,
 * interesting data to show.
 *
 * Determinism: seeded from the prompt content so replays produce the same output
 * for the same input.
 */
export class SmartMockLlmService implements LlmService {
  async complete({ prompt, model, systemPrompt }: {
    prompt: string;
    model?: string;
    temperature?: number;
    systemPrompt?: string;
  }): Promise<LlmCompletion> {
    const start = Date.now();
    // Hash from the full effective prompt (system + user) so changing the base
    // prompt produces a different inputHash — important for replay correctness.
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const seed = hashString(fullPrompt);

    // Agent detection still keys off the role-specific marker, which lives in
    // the user prompt regardless of the base.
    const agentName = detectAgent(prompt);
    const output = generateForAgent(agentName, seed);
    const text = JSON.stringify(output);

    // Simulate realistic latency (50-400ms range seeded)
    const latency = 50 + (seed % 350);
    await new Promise((r) => setTimeout(r, Math.min(latency, 20)));

    const tokensIn = Math.ceil(prompt.length / 4);
    const tokensOut = Math.ceil(text.length / 4);

    return {
      text,
      latencyMs: latency,
      tokensIn,
      tokensOut,
      costUsd: +(tokensIn * 0.000003 + tokensOut * 0.000015).toFixed(6),
      provider: 'mock',
      modelName: model ?? 'mock-smart-1',
    };
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededFloat(seed: number, min: number, max: number): number {
  const x = ((seed * 9301 + 49297) % 233280) / 233280;
  return +(min + x * (max - min)).toFixed(3);
}

function pick<T>(seed: number, arr: T[]): T {
  return arr[seed % arr.length]!;
}

function detectAgent(prompt: string): string {
  // Match on the "You are [a/the] X" prefix from the seeded prompt templates.
  // These markers are unique per agent and only appear once (at the top of the
  // template). Order matters: audit agents (head trader, risk auditor, etc.)
  // come first because their prompts include specialist output JSON, which can
  // contain words like "momentum" or "regime" that would otherwise false-match.
  const lower = prompt.toLowerCase();
  // Each agent can have multiple markers — accommodates prompt iteration across
  // versions (e.g., trendRegime v0.1.0 vs v0.2.0 start with different role lines).
  // Order matters: audit/decision agents are checked first so their prompts (which
  // contain specialist output JSON) don't false-match a specialist.
  // v0.2.0 markers first, v0.1.0 fallbacks after. Decision/audit agents first
  // so their prompts (which include specialist JSON) don't false-match specialists.
  const checks: Array<[string, string]> = [
    ['headTrader',        'you are the head trader'],
    ['riskAuditor',       'you are the risk auditor'],
    ['devilsAdvocate',    "you are the devil's advocate"],
    ['critic',            'you are the critic'],                             // v0.2.0
    ['critic',            'you are the post-cycle critic'],                  // v0.1.0
    ['trendRegime',       'you are the trend & regime specialist'],          // v0.2.0
    ['trendRegime',       'you are a market-regime analyst'],                // v0.1.0
    ['setupPattern',      'you are the setup pattern specialist'],           // v0.2.0
    ['setupPattern',      'you are a swing-trading setup-pattern analyst'],  // v0.1.0
    ['momentum',          'you are the momentum specialist'],                // v0.2.0
    ['momentum',          'you are a momentum analyst'],                     // v0.1.0
    ['meanReversion',     'you are the mean reversion specialist'],          // v0.2.0
    ['meanReversion',     'you are a mean-reversion analyst'],               // v0.1.0
    ['volumeFlow',        'you are the volume flow specialist'],             // v0.2.0
    ['volumeFlow',        'you are a volume-flow analyst'],                  // v0.1.0
    ['newsEvents',        'you are the news & events specialist'],           // v0.2.0
    ['newsEvents',        'you are a news & events analyst'],                // v0.1.0
    ['macroContext',      'you are the macro context specialist'],           // v0.2.0
    ['macroContext',      'you are a macro context analyst'],                // v0.1.0
    ['liquiditySlippage', 'you are the liquidity & slippage specialist'],    // v0.2.0
    ['liquiditySlippage', 'you are a liquidity & slippage analyst'],         // v0.1.0
  ];
  for (const [name, marker] of checks) {
    if (lower.includes(marker)) return name;
  }
  return 'generic';
}

function generateForAgent(agent: string, seed: number): any {
  const score = seededFloat(seed, -0.8, 0.8);
  const conf = seededFloat(seed >> 3, 0.25, 0.95);
  const base = {
    bullishScore: score,
    confidence: conf,
    rationale: [
      pick(seed, ['Price above SMA20 with rising momentum', 'RSI approaching oversold', 'Volume surging on up-day', 'Consolidation near support', 'MACD crossing signal line']),
      pick(seed >> 2, ['Recent earnings beat expectations', 'Sector rotation favoring tech', 'Breadth improving', 'Bid-side accumulation visible', 'Stop-run reversal pattern']),
    ],
    flags: [] as string[],
    extras: {} as any,
  };

  switch (agent) {
    case 'trendRegime':
      base.extras = {
        regime: pick(seed, ['bull_trending', 'bull_choppy', 'bear_trending', 'bear_choppy']),
        stage: pick(seed >> 1, [1, 2, 3, 4]),
      };
      break;
    case 'setupPattern':
      base.extras = {
        setupName: pick(seed, ['pullback_to_sma20', 'breakout_continuation', 'base_and_break', 'gap_fill', null]),
        qualityGrade: pick(seed >> 1, ['A', 'B', 'C', 'none']),
        entryZone: { low: +(100 + (seed % 50)).toFixed(2), high: +(100 + (seed % 50) + 3).toFixed(2) },
      };
      if (base.extras.setupName) base.flags.push(base.extras.setupName.split('_')[0]!);
      break;
    case 'momentum':
      base.extras = { momentumState: pick(seed, ['accelerating', 'steady', 'fading', 'exhausted']) };
      if (score > 0.5) base.flags.push('overbought');
      if (score < -0.5) base.flags.push('oversold');
      break;
    case 'meanReversion':
      base.extras = { extensionATR: seededFloat(seed, 0.2, 3.5), revertProbability: seededFloat(seed >> 2, 0.1, 0.8) };
      if (score < -0.3) base.flags.push('oversold');
      if (score > 0.3) base.flags.push('overbought');
      break;
    case 'volumeFlow':
      base.extras = {
        accumulationScore: seededFloat(seed, -0.9, 0.9),
        surgeDays: seed % 5,
        volumeRatio: seededFloat(seed >> 1, 0.5, 2.5),
      };
      if (base.extras.volumeRatio > 1.8) base.flags.push('volume_surge');
      if (base.extras.volumeRatio < 0.6) base.flags.push('volume_dry');
      break;
    case 'newsEvents':
      base.extras = {
        catalystImminent: seed % 4 === 0,
        earningsWithinDays: seed % 3 === 0 ? (seed % 30) + 1 : null,
        sentimentNet: seededFloat(seed, -0.6, 0.6),
      };
      if (base.extras.catalystImminent) base.flags.push('earnings_window');
      break;
    case 'macroContext':
      base.extras = {
        breadthState: pick(seed, ['expanding', 'mixed', 'deteriorating']),
        sectorRsRank: (seed % 11) + 1,
      };
      break;
    case 'liquiditySlippage': {
      base.bullishScore = 0;
      // Mock output shape matches the v0.3.0 prompt's required fields so
      // downstream consumers (head trader veto reads, influenceTag derivation)
      // see realistic structure even in dev mode.
      const spreadBps = seededFloat(seed, 2, 60);
      const tradable = spreadBps < 50 && seed % 11 !== 0;
      const executionRisk =
        spreadBps >= 50 || !tradable
          ? 'extreme'
          : spreadBps >= 20
            ? 'high'
            : spreadBps >= 8
              ? 'moderate'
              : 'low';
      const dollarDepth = 500 + (seed % 20) * 500;
      base.extras = {
        tradable,
        spreadBps,
        executionRisk,
        estimatedSlippageBps: +(spreadBps * 1.2).toFixed(2),
        maxSuggestedPositionSize: tradable ? Math.min(dollarDepth * 3, 3000) : 0,
        nbboDollarDepth: dollarDepth,
        shortable: seed % 7 !== 0,
        // Confidence reflects the agent's certainty in the tradability call,
        // not the magnitude of the spread.
      };
      if (!tradable) base.flags.push('illiquid');
      else if (spreadBps >= 20) base.flags.push('wide_spread');
      else base.flags.push('tradable');
      break;
    }
    case 'headTrader':
      return generateHeadTrader(seed, score, conf);
    case 'riskAuditor':
      return generateRiskAuditor(seed, conf);
    case 'devilsAdvocate':
      return generateDevilsAdvocate(seed, conf);
    case 'critic':
      return generateCritic(seed);
  }
  return base;
}

function generateHeadTrader(seed: number, score: number, conf: number) {
  const action = conf > 0.5 && score > 0.2 ? 'BUY' : conf > 0.5 && score < -0.2 ? 'SELL' : 'HOLD';
  const entry = +(100 + (seed % 150)).toFixed(2);
  const stopDist = +(entry * 0.03).toFixed(2);
  // For BUY: stop below entry, targets above. For SELL: inverted.
  const dir = action === 'SELL' ? -1 : 1;
  return {
    action,
    conviction: conf,
    setupName: action === 'BUY' ? pick(seed, ['pullback_to_sma20', 'breakout_continuation', 'base_and_break']) : null,
    entry,
    stop: action !== 'HOLD' ? +(entry - stopDist * dir).toFixed(2) : null,
    target1: action !== 'HOLD' ? +(entry + stopDist * 1.6 * dir).toFixed(2) : null,
    target2: action !== 'HOLD' ? +(entry + stopDist * 3.2 * dir).toFixed(2) : null,
    riskPctOfEquity: Math.min(conf * 0.025, 0.02),
    timeStopBars: 10,
    invalidationCriteria: ['Close below stop', 'Regime shifts to bear_trending'],
    reasoningTrace: [
      { round: 1, thought: `Specialists lean ${score > 0 ? 'bullish' : 'bearish'} (avg ${score.toFixed(2)})`, toolUsed: null },
      { round: 2, thought: `Conviction ${conf.toFixed(2)} ${conf > 0.5 ? 'exceeds' : 'below'} threshold`, toolUsed: 'get_atr_stop_suggestion' },
    ],
  };
}

function generateRiskAuditor(seed: number, conf: number) {
  const grade = conf > 0.7 ? pick(seed, ['A', 'B']) : pick(seed, ['B', 'C', 'F']);
  return {
    bullishScore: 0,
    confidence: conf,
    rationale: [
      pick(seed, ['Stop placement is sensible relative to recent ATR', 'Stop too tight for current volatility']),
      pick(seed >> 1, ['Position size within 2% risk cap', 'Risk-to-reward ratio is favorable', 'Concentration risk is manageable']),
    ],
    flags: [],
    extras: {
      riskGrade: grade,
      objections: grade === 'F'
        ? ['Stop too tight — likely noise stop-out', 'Position adds concentration to an overweight sector']
        : grade === 'C'
        ? ['Target1 less than 1.5R']
        : [],
    },
  };
}

function generateDevilsAdvocate(seed: number, conf: number) {
  return {
    bullishScore: 0,
    confidence: conf,
    rationale: [
      pick(seed, ['Sector rotation away from this group', 'Breadth deteriorating beneath the surface']),
      pick(seed >> 1, ['Earnings in 3 days adds binary risk', 'Recent rally may be exhaustion move']),
    ],
    flags: [],
    extras: {
      opposeScore: seededFloat(seed, 0.2, 0.9),
      topRisks: [
        pick(seed, ['Earnings gap risk within holding period', 'Fed meeting Wednesday may spike volatility']),
        pick(seed >> 1, ['Volume declining into rally — distribution risk', 'RSI divergence forming on daily']),
        pick(seed >> 2, ['Sector breadth failing — this name may follow', 'Stop is below key support — crowded trade']),
      ],
    },
  };
}

function generateCritic(seed: number) {
  return {
    severity: pick(seed, ['info', 'warn', 'warn', 'error']),
    body: pick(seed, [
      'Head trader over-weighted the momentum specialist despite RSI divergence flagged by meanReversion.',
      'Setup quality was C-grade but conviction was set at 0.7 — grade should have lowered conviction.',
      'Stop was sensible but target1 was unrealistic given recent ATR contraction.',
      'Good trade — all specialists aligned, risk was well-sized, and the regime was favorable.',
    ]),
    tags: pick(seed, [
      ['overweight_momentum', 'missed_divergence'],
      ['conviction_too_high', 'low_setup_grade'],
      ['unrealistic_target'],
      ['good_trade'],
    ]),
  };
}
