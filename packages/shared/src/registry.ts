/**
 * Static metadata for every LLM-driven agent in the system. Single source of truth
 * shared between engine (which uses prompt versions for persistence) and api/ui
 * (which display agent capabilities).
 *
 * V1 agents will be removed when V2 checks out — entries are tagged so the UI
 * can section them or hide them when the day comes.
 */

export type EngineVersion = 'v1' | 'v2';
export type AgentKind = 'specialist' | 'agent' | 'head_trader';

export interface AgentMetadata {
  /** Stable machine name used in DB rows (matches PromptVersion.agentName / SpecialistAnalysis.specialistName). */
  name: string;
  displayName: string;
  engineVersion: EngineVersion;
  kind: AgentKind;
  /** Current default prompt version baked into the codebase. Persisted versions in DB may include earlier ones too. */
  promptVersion: string;
  role: string;
  /** What the agent actually does, in plain English — 2–4 lines. */
  description: string;
  /** Names of structured fields the agent emits in `extras` (V2) or doesn't (V1). */
  extras: Array<{ key: string; description: string }>;
  /** Flags this agent commonly emits (V2 specialists). */
  flags?: string[];
  /** Inputs / data dependencies. */
  inputs: string[];
  /** Whether the agent currently calls tools (M4+). */
  toolUsing: boolean;
}

export const V1_AGENT_REGISTRY: AgentMetadata[] = [
  {
    name: 'momentum',
    displayName: 'Momentum (V1)',
    engineVersion: 'v1',
    kind: 'agent',
    promptVersion: 'v1.0.0',
    role: 'Trend-following technical analyst.',
    description:
      'Evaluates trend strength using RSI position, price vs SMA20/50, and volume. Single-shot LLM call producing a bullish score, confidence, and rationale.',
    extras: [],
    inputs: ['RSI(14)', 'SMA(20)', 'SMA(50)', 'volume', 'avg volume'],
    toolUsing: false,
  },
  {
    name: 'meanReversion',
    displayName: 'Mean Reversion (V1)',
    engineVersion: 'v1',
    kind: 'agent',
    promptVersion: 'v1.0.0',
    role: 'Contrarian technical analyst — looks for extended conditions likely to revert.',
    description:
      'RSI extremes plus distance from SMA20. Bearish on overbought, bullish on oversold.',
    extras: [],
    inputs: ['RSI(14)', 'SMA(20)', 'close'],
    toolUsing: false,
  },
  {
    name: 'confirmation',
    displayName: 'Confirmation (V1)',
    engineVersion: 'v1',
    kind: 'agent',
    promptVersion: 'v1.0.0',
    role: 'Cross-validates signals via MACD + SMA crossover.',
    description:
      'Confluence checker. Reports bullish confirmation when MACD histogram is positive and SMA20 > SMA50, bearish on the inverse.',
    extras: [],
    inputs: ['MACD histogram', 'SMA(20)', 'SMA(50)'],
    toolUsing: false,
  },
  {
    name: 'newsEvents',
    displayName: 'News & Events (V1)',
    engineVersion: 'v1',
    kind: 'agent',
    promptVersion: 'v1.0.0',
    role: 'News + sentiment analyst (V1).',
    description:
      'Reads articles + web-search results. Reports bullishness, catalyst awareness, and risks. Returns LOW confidence when no meaningful news is available.',
    extras: [],
    inputs: ['Alpaca news articles', 'OpenAI web-search results'],
    toolUsing: false,
  },
];

export const V2_SPECIALIST_REGISTRY: AgentMetadata[] = [
  {
    name: 'trendRegime',
    displayName: 'Trend & Regime',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.trendRegime.0.1.0',
    role: 'Classifies market regime + Stage 1–4 of the symbol.',
    description:
      'Uses close vs SMA20/SMA50 (and SMA200 if known) to label the regime as bull_trending / bull_choppy / bear_trending / bear_choppy. Outputs Stage 1 (basing), 2 (markup), 3 (distribution), or 4 (markdown).',
    extras: [
      { key: 'regime', description: 'bull_trending | bull_choppy | bear_trending | bear_choppy' },
      { key: 'stage', description: '1 (basing) | 2 (markup) | 3 (distribution) | 4 (markdown)' },
    ],
    flags: [],
    inputs: ['close', 'SMA(20)', 'SMA(50)'],
    toolUsing: false,
  },
  {
    name: 'setupPattern',
    displayName: 'Setup Pattern',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.setupPattern.0.1.0',
    role: 'Identifies named swing-trading setups, or admits there is none.',
    description:
      'Recognizes pullback_to_sma20, pullback_to_sma50, breakout_continuation, breakout_retest, base_and_break, gap_fill, failed_breakdown, mean_reversion_oversold. Grades each A/B/C/none.',
    extras: [
      { key: 'setupName', description: 'name of the recognized setup, or null' },
      { key: 'qualityGrade', description: '"A" | "B" | "C" | "none"' },
      { key: 'entryZone', description: '{ low: number, high: number } when setup exists' },
    ],
    flags: ['pullback', 'breakout', 'breakdown', 'base', 'gap', 'oversold'],
    inputs: ['OHLC', 'SMA(20)', 'SMA(50)', 'recent highs/lows', 'consolidation detection'],
    toolUsing: false,
  },
  {
    name: 'momentum',
    displayName: 'Momentum',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.momentum.0.1.0',
    role: 'Distinguishes healthy momentum from parabolic exhaustion.',
    description:
      'Reads RSI(14) zone, MACD sign, and price location. Flags overbought/oversold and reports a momentumState of accelerating | steady | fading | exhausted.',
    extras: [
      { key: 'momentumState', description: 'accelerating | steady | fading | exhausted' },
    ],
    flags: ['overbought', 'oversold'],
    inputs: ['RSI(14)', 'MACD histogram', 'SMA(20)', 'SMA(50)'],
    toolUsing: false,
  },
  {
    name: 'meanReversion',
    displayName: 'Mean Reversion',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.meanReversion.0.1.0',
    role: 'Stretched-condition detector with magnitude + revert probability.',
    description:
      'Quantifies how far price has stretched from SMA20 in approximate ATR units, and assigns a revertProbability. Strongest in choppy regimes.',
    extras: [
      { key: 'extensionATR', description: 'magnitude of extension in approximate ATR units' },
      { key: 'revertProbability', description: 'probability of mean reversion (0–1)' },
    ],
    flags: ['overbought', 'oversold'],
    inputs: ['RSI(14)', 'close', 'SMA(20)'],
    toolUsing: false,
  },
  {
    name: 'volumeFlow',
    displayName: 'Volume Flow',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.volumeFlow.0.1.0',
    role: 'Accumulation vs distribution from volume context.',
    description:
      'Compares current volume to 30-day average. High volume on up-days = accumulation; high volume on down-days = distribution. Reports an accumulationScore in [-1, 1].',
    extras: [
      { key: 'accumulationScore', description: '-1 (distribution) to +1 (accumulation)' },
      { key: 'surgeDays', description: 'count of recent surge days observed' },
      { key: 'volumeRatio', description: 'current volume / 30-day average' },
    ],
    flags: ['volume_surge', 'volume_dry'],
    inputs: ['volume', 'avg volume', 'close', 'SMA(20)'],
    toolUsing: false,
  },
  {
    name: 'newsEvents',
    displayName: 'News & Events',
    engineVersion: 'v2',
    kind: 'specialist',
    promptVersion: 'v2.newsEvents.0.1.0',
    role: 'Catalyst + earnings-window awareness with sentiment.',
    description:
      'Identifies imminent catalysts (earnings, FDA, macro prints), net sentiment from headlines, and contradictions to the technical setup. Returns LOW confidence when no news exists.',
    extras: [
      { key: 'catalystImminent', description: 'true if catalyst within 14 days' },
      { key: 'earningsWithinDays', description: 'days until next earnings, or null' },
      { key: 'sentimentNet', description: 'net sentiment, -1 to +1' },
    ],
    flags: ['earnings_window', 'macro_event'],
    inputs: ['Alpaca news articles', 'OpenAI web-search results'],
    toolUsing: false,
  },
];

export const HEAD_TRADER_REGISTRY: AgentMetadata = {
  name: 'headTrader',
  displayName: 'Head Trader',
  engineVersion: 'v2',
  kind: 'head_trader',
  promptVersion: 'v2.headTrader.0.3.0-tool-using',
  role: 'Final decision maker — reads all specialist reports, calls tools to verify, emits a complete trade plan.',
  description:
    'Receives the six specialist outputs plus market context. Calls tools (market regime, ATR stop suggestion, recent news, position history, correlations, sector RS, earnings calendar, indicators) to verify or extend the specialists\' analysis across up to 6 rounds. Emits a complete TradePlan via the terminal submit_decision tool. Enforces kill criteria: catalysts within 2 days, bear-trending regime without compatible setup, momentum exhaustion, drawdown ladder.',
  extras: [
    { key: 'action', description: 'BUY | SELL | HOLD | CLOSE' },
    { key: 'conviction', description: '0–1, < 0.5 forces HOLD' },
    { key: 'setupName', description: 'borrowed from setupPattern specialist when BUY' },
    { key: 'entry / stop / target1 / target2', description: 'price levels (BUY requires stop)' },
    { key: 'riskPctOfEquity', description: 'capped at maxRiskPctPerTrade from RiskConfig' },
    { key: 'invalidationCriteria', description: 'narrative kill switches' },
    { key: 'reasoningTrace', description: 'array of { round, thought, toolUsed } — synthesized by the loop' },
  ],
  flags: [],
  inputs: ['all 6 specialist outputs', 'market context', 'sandbox state', 'open position', '10 callable tools'],
  toolUsing: true,
};

export const AGENT_REGISTRY: AgentMetadata[] = [
  ...V2_SPECIALIST_REGISTRY,
  HEAD_TRADER_REGISTRY,
  ...V1_AGENT_REGISTRY,
];
