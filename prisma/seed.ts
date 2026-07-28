/**
 * Seeds the V2 agent registry + initial prompt versions.
 *
 * Run:  npm run prisma:seed
 *
 * Re-running is safe — upserts on (agent.name) + (agentId, version).
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { outputContractFor } from '../backend/src/schemas/agent-outputs';
import { GROWTH_SCOUT_PROMPT_V_0_1_0 } from '../backend/src/prompts/growthScout.v0.1.0';

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL is not set — see .env.example');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Base prompt — prepended (as system prompt) to every agent's role-specific
// template. Defines the institutional-grade discipline framework shared across
// the entire system.
// ---------------------------------------------------------------------------

const BASE_PROMPT_V010 = `You are a specialized institutional-grade swing trading analysis agent operating within a multi-agent trading system.

Your role is NOT to predict the future with certainty.
Your role is to:

* analyze current market conditions objectively,
* quantify probabilities,
* identify asymmetric opportunities,
* and communicate uncertainty clearly.

You must NEVER:

* invent data,
* ignore contradictory evidence,
* overstate confidence,
* or produce vague reasoning.

You must distinguish:

1. Raw observations
2. Technical interpretations
3. Statistical implications
4. Risk factors
5. Confidence level

All outputs must:

* be deterministic and structured,
* use precise financial terminology,
* avoid emotional language,
* and remain internally consistent.

You are one specialist among many.
You are NOT the final decision maker unless explicitly designated as Head Trader.

When evidence conflicts:

* lower confidence,
* explain the conflict,
* and avoid forcing bullish/bearish conclusions.

You must prioritize:

1. Capital preservation
2. Regime awareness
3. Risk-adjusted expectancy
4. Liquidity realism
5. Discipline over activity

If data quality is insufficient:

* return "INSUFFICIENT_DATA"
* explain what is missing
* avoid speculative extrapolation

Always output valid JSON only.

Your reasoning must reflect how professional swing traders think:

* probabilistically,
* conditionally,
* and with awareness of market regime dependency.

Every conclusion must be traceable to observable evidence.`;

interface SeedAgent {
  name: string;
  displayName: string;
  kind: 'specialist' | 'head_trader' | 'risk_auditor' | 'devils_advocate' | 'critic' | 'scout';
  role: string;
  description: string;
  metadata: {
    inputs: string[];
    flags?: string[];
    extras?: Array<{ key: string; description: string }>;
    toolUsing?: boolean;
  };
  // Note: `outputContract` is intentionally NOT a SeedAgent field — it's
  // looked up at upsert time via `outputContractFor(agent.name)` so the
  // contract stays in lockstep with the Zod schema in `schemas/agent-outputs.ts`.
  initialPrompt: { version: string; directiveTemplate: string; changelog?: string };
}

const AGENTS: SeedAgent[] = [
  {
    name: 'trendRegime',
    displayName: 'Trend & Regime',
    kind: 'specialist',
    role: 'Classifies market regime + Stage 1–4.',
    description:
      'Uses close vs SMA20/SMA50 (and SMA200 if known) to label regime as bull_trending / bull_choppy / bear_trending / bear_choppy plus Stage 1 (basing), 2 (markup), 3 (distribution), 4 (markdown).',
    metadata: {
      inputs: ['close', 'SMA(20)', 'SMA(50)'],
      extras: [
        { key: 'regime', description: 'bull_trending | bull_choppy | bear_trending | bear_choppy' },
        { key: 'stage', description: '1 | 2 | 3 | 4' },
      ],
    },
    initialPrompt: {
      version: '0.1.0',
      directiveTemplate: trendRegimePrompt(),
      changelog: 'Initial V2 prompt for trend & regime classification.',
    },
  },
  {
    name: 'setupPattern',
    displayName: 'Setup Pattern',
    kind: 'specialist',
    role: 'Identifies named swing-trading setups or admits there is none.',
    description:
      'Recognizes pullback_to_sma20, pullback_to_sma50, breakout_continuation, breakout_retest, base_and_break, gap_fill, failed_breakdown, mean_reversion_oversold. Grades each A/B/C/none.',
    metadata: {
      inputs: ['OHLC', 'SMA(20)', 'SMA(50)'],
      flags: ['pullback', 'breakout', 'breakdown', 'base', 'gap', 'oversold'],
      extras: [
        { key: 'setupName', description: 'recognized setup or null' },
        { key: 'qualityGrade', description: 'A | B | C | none' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: setupPatternPrompt() },
  },
  {
    name: 'momentum',
    displayName: 'Momentum',
    kind: 'specialist',
    role: 'Distinguishes healthy momentum from parabolic exhaustion.',
    description: 'Reads RSI(14), MACD sign, and price location to label accelerating / steady / fading / exhausted.',
    metadata: {
      inputs: ['RSI(14)', 'MACD histogram', 'SMA(20)', 'SMA(50)'],
      flags: ['overbought', 'oversold'],
      extras: [{ key: 'momentumState', description: 'accelerating | steady | fading | exhausted' }],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: momentumPrompt() },
  },
  {
    name: 'meanReversion',
    displayName: 'Mean Reversion',
    kind: 'specialist',
    role: 'Stretched-condition detector with magnitude + revert probability.',
    description: 'Quantifies extension from SMA20 in approximate ATR units and assigns a revertProbability.',
    metadata: {
      inputs: ['RSI(14)', 'close', 'SMA(20)'],
      flags: ['overbought', 'oversold'],
      extras: [
        { key: 'extensionATR', description: 'extension magnitude in ATR units' },
        { key: 'revertProbability', description: '0–1' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: meanReversionPrompt() },
  },
  {
    name: 'volumeFlow',
    displayName: 'Volume Flow',
    kind: 'specialist',
    role: 'Accumulation vs distribution from volume context.',
    description: 'Compares current volume to 30-day average; high volume on up-days = accumulation; high on down-days = distribution.',
    metadata: {
      inputs: ['volume', 'avg volume', 'close', 'SMA(20)'],
      flags: ['volume_surge', 'volume_dry'],
      extras: [{ key: 'accumulationScore', description: '-1 (distribution) to +1 (accumulation)' }],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: volumeFlowPrompt() },
  },
  {
    name: 'newsEvents',
    displayName: 'News & Events',
    kind: 'specialist',
    role: 'Catalyst + earnings-window awareness with sentiment.',
    description: 'Identifies imminent catalysts (earnings, FDA, macro prints), net sentiment from headlines, and contradictions to the technical setup.',
    metadata: {
      inputs: ['Alpaca news articles', 'web-search results'],
      flags: ['earnings_window', 'macro_event'],
      extras: [
        { key: 'catalystImminent', description: 'true if catalyst within 14 days' },
        { key: 'sentimentNet', description: '-1 to +1' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: newsEventsPrompt() },
  },
  {
    name: 'macroContext',
    displayName: 'Macro Context',
    kind: 'specialist',
    role: 'Rates, dollar, sector rotation, breadth.',
    description: 'Separates broad-market risk from single-stock signal. Bearish if breadth is weak even when the symbol is bid.',
    metadata: {
      inputs: ['SPY/QQQ regime', '10Y yield', 'DXY', 'sector RS', 'advance/decline'],
      extras: [
        { key: 'breadthState', description: 'expanding | mixed | deteriorating' },
        { key: 'sectorRsRank', description: '1 (best) – 11 (worst) S&P sector RS rank' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: macroContextPrompt() },
  },
  {
    name: 'liquiditySlippage',
    displayName: 'Liquidity & Slippage',
    kind: 'specialist',
    role: 'Realism check: can we actually execute this at the proposed size?',
    description: 'Checks bid/ask spread, average $-volume, and whether the proposed entry/exit fills are plausible at the trade size.',
    metadata: {
      inputs: ['avg $ volume', 'bid/ask spread (proxy)', 'trade size'],
      extras: [
        { key: 'tradableScore', description: '0 (illiquid) – 1 (deeply tradable)' },
        { key: 'expectedSlippageBps', description: 'estimated slippage in basis points' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: liquiditySlippagePrompt() },
  },
  {
    name: 'headTrader',
    displayName: 'Head Trader',
    kind: 'head_trader',
    role: 'Final decision maker — reads all specialist reports, calls tools, emits a complete TradePlan.',
    description:
      'Receives the specialist outputs + market context + sandbox state. Calls verification tools across rounds. Emits action, conviction, entry, stop, target1/2, riskPctOfEquity, invalidationCriteria, reasoningTrace.',
    metadata: {
      inputs: ['all specialist outputs', 'market context', 'sandbox state', 'open position'],
      extras: [
        { key: 'action', description: 'BUY | SELL | HOLD | CLOSE' },
        { key: 'conviction', description: '0–1, <0.5 forces HOLD' },
        { key: 'reasoningTrace', description: 'array of { round, thought, toolUsed }' },
      ],
      toolUsing: true,
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: headTraderPrompt() },
  },
  {
    name: 'riskAuditor',
    displayName: 'Risk Auditor',
    kind: 'risk_auditor',
    role: 'Independent reviewer of the head trader\'s trade plan.',
    description:
      'Scores plan on R-multiple sanity, stop placement vs ATR, position size discipline, and concentration. Adversarial to the head trader — exists to catch slop.',
    metadata: {
      inputs: ['TradePlan', 'sandbox state', 'open positions'],
      extras: [
        { key: 'riskGrade', description: 'A | B | C | F' },
        { key: 'objections', description: 'list of specific objections' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: riskAuditorPrompt() },
  },
  {
    name: 'devilsAdvocate',
    displayName: 'Devil\'s Advocate',
    kind: 'devils_advocate',
    role: 'Red-team adversary that argues against the head trader\'s plan.',
    description:
      'Given the proposed plan, generates the strongest case AGAINST taking the trade. Audit captures whether vocal objections correlated with losses (the red team was right) or wins (the head trader was right).',
    metadata: {
      inputs: ['TradePlan', 'specialist outputs', 'market context'],
      extras: [
        { key: 'opposeScore', description: '0 (concur) – 1 (strongly oppose)' },
        { key: 'topRisks', description: 'top 3 reasons this trade fails' },
      ],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: devilsAdvocatePrompt() },
  },
  {
    name: 'critic',
    displayName: 'Critic (post-cycle)',
    kind: 'critic',
    role: 'Post-cycle reviewer of the head trader\'s reasoning trace.',
    description:
      'Runs after a trade is closed. Re-reads the full reasoning trace with the outcome known and notes what was missed or overweighted. Writes Critique rows that feed prompt iteration.',
    metadata: {
      inputs: ['Deliberation.reasoningTrace', 'TradePlan', 'TradeOutcome'],
      extras: [{ key: 'lessons', description: 'list of structured lessons learned' }],
    },
    initialPrompt: { version: '0.1.0', directiveTemplate: criticPrompt() },
  },
  {
    name: 'growthScout',
    displayName: 'Growth Scout',
    kind: 'scout',
    role: 'Universe-wide stock discovery — surfaces watchlist candidates for operator approval.',
    description:
      'Runs OUTSIDE the daily trading cycle (weekly cadence, manual /api/watchlist/discover trigger). Receives quant snapshot + fundamentals per candidate. Emits WatchlistProposal rows that an operator approves or rejects through the UI. Never modifies the live watchlist directly.',
    metadata: {
      inputs: ['Alpaca snapshot', 'Finnhub fundamentals', 'Existing watchlist (exclusion)'],
      extras: [
        { key: 'viabilityScore', description: '0..1 — overall growth-viability call' },
        { key: 'growthThesis', description: 'one-paragraph thesis' },
        { key: 'concerns', description: 'evidence-based concerns array' },
        { key: 'recommendForWatchlist', description: 'binary recommendation (≥0.65 score required)' },
      ],
    },
    initialPrompt: {
      version: '0.1.0',
      directiveTemplate: GROWTH_SCOUT_PROMPT_V_0_1_0,
      changelog: 'Initial scout prompt — quant + fundamentals interpretation, evidence-standard rationale.',
    },
  },
];

async function main() {
  // ---- Base prompt — applied as system prompt for every agent ----
  await prisma.basePromptVersion.upsert({
    where: { version: '0.1.0' },
    update: { template: BASE_PROMPT_V010, isActive: true },
    create: { version: '0.1.0', template: BASE_PROMPT_V010, isActive: true, changelog: 'Initial discipline framework — institutional-grade agent ground rules.' },
  });
  // Make sure only this one is active.
  await prisma.basePromptVersion.updateMany({
    where: { version: { not: '0.1.0' } },
    data: { isActive: false },
  });
  // eslint-disable-next-line no-console
  console.log('  ✓ BasePromptVersion 0.1.0 (active)');

  // eslint-disable-next-line no-console
  console.log(`Seeding ${AGENTS.length} agents...`);
  for (const a of AGENTS) {
    const agent = await prisma.agent.upsert({
      where: { name: a.name },
      update: {
        displayName: a.displayName,
        kind: a.kind as any,
        role: a.role,
        description: a.description,
        metadata: a.metadata as any,
      },
      create: {
        name: a.name,
        displayName: a.displayName,
        kind: a.kind as any,
        role: a.role,
        description: a.description,
        metadata: a.metadata as any,
      },
    });
    const contract = outputContractFor(a.name);
    const pv = await prisma.promptVersion.upsert({
      where: { agentId_version: { agentId: agent.id, version: a.initialPrompt.version } },
      update: {
        directiveTemplate: a.initialPrompt.directiveTemplate,
        outputContract: contract,
        changelog: a.initialPrompt.changelog,
      },
      create: {
        agentId: agent.id,
        version: a.initialPrompt.version,
        directiveTemplate: a.initialPrompt.directiveTemplate,
        outputContract: contract,
        changelog: a.initialPrompt.changelog,
        isActive: true,
      },
    });
    await prisma.agent.update({ where: { id: agent.id }, data: { activePromptVersionId: pv.id } });
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${a.name} @ ${a.initialPrompt.version}`);
  }

  // Seed initial RiskConfig if empty.
  const existingRisk = await prisma.riskConfig.findFirst();
  if (!existingRisk) {
    await prisma.riskConfig.create({ data: { reason: 'initial seed', author: 'seed' } });
    // eslint-disable-next-line no-console
    console.log('  ✓ RiskConfig (defaults)');
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// ---------------------------------------------------------------------------
// (No-op: BASE_PROMPT_V010 is hoisted to the top of the file so `main()` can
// reference it before the prompt template functions below.)
// ---------------------------------------------------------------------------

const _BASE_PROMPT_V010_DUP_GUARD = '';

// ---------------------------------------------------------------------------
// Prompt templates — kept inline so the seed is self-contained.
// Iterate on these in code; persist new versions via a migration or admin route.
// ---------------------------------------------------------------------------

function trendRegimePrompt(): string {
  return `You are a market-regime analyst.

Inputs: close, SMA20, SMA50.

Classify the regime: bull_trending | bull_choppy | bear_trending | bear_choppy.
Assign a Weinstein stage: 1 (basing) | 2 (markup) | 3 (distribution) | 4 (markdown).`;
}

function setupPatternPrompt(): string {
  return `You are a swing-trading setup-pattern analyst.

Identify ONE named setup or declare none:
pullback_to_sma20 | pullback_to_sma50 | breakout_continuation | breakout_retest |
base_and_break | gap_fill | failed_breakdown | mean_reversion_oversold | none

Grade A/B/C if a setup exists.`;
}

function momentumPrompt(): string {
  return `You are a momentum analyst.

Reads: RSI(14), MACD histogram, SMA20/SMA50 alignment.

Label momentumState: accelerating | steady | fading | exhausted.`;
}

function meanReversionPrompt(): string {
  return `You are a mean-reversion analyst.

Quantify extension from SMA20 in ATR units. Estimate revert probability.`;
}

function volumeFlowPrompt(): string {
  return `You are a volume-flow analyst.

Compare current volume to 30d avg. Compute accumulationScore in [-1, +1]:
+1 = aggressive accumulation, -1 = distribution.`;
}

function newsEventsPrompt(): string {
  return `You are a news & events analyst.

Identify catalysts within 14 days. Compute sentimentNet from headlines. If no
meaningful news exists, return confidence <= 0.2 and bullishScore near 0.`;
}

function macroContextPrompt(): string {
  return `You are a macro context analyst.

Inputs: SPY/QQQ regime, 10Y yield direction, DXY direction, sector RS rank,
advance/decline ratio.

Label breadthState: expanding | mixed | deteriorating.`;
}

function liquiditySlippagePrompt(): string {
  return `You are a liquidity & slippage analyst.

Given symbol and trade size, evaluate whether entry/exit are realistic.
Score tradability in [0, 1] and estimate slippage in bps.`;
}

function headTraderPrompt(): string {
  return `You are the Head Trader. Read all specialist analyses, the macro context,
the liquidity check, and the sandbox state. Use tools to verify your hypothesis.
Then emit ONE complete TradePlan.

Kill criteria (forced HOLD):
- catalystImminent within 2 days
- bear_trending regime without a compatible setup
- momentumState == exhausted while BUYing
- drawdown ladder triggered`;
}

function riskAuditorPrompt(): string {
  return `You are the Risk Auditor. Independent of the Head Trader. Score the
proposed TradePlan on risk discipline:
- Is the stop placed sensibly relative to ATR?
- Is target1 at least 1.5R?
- Does riskPctOfEquity respect maxRiskPctPerTrade?
- Does the position add concentration vs already-open trades?`;
}

function devilsAdvocatePrompt(): string {
  return `You are the Devil's Advocate. Argue the strongest case AGAINST taking the
Head Trader's proposed trade. List top 3 specific failure modes.`;
}

function criticPrompt(): string {
  return `You are the post-cycle Critic. You receive the full Deliberation.reasoningTrace
plus the TradePlan AND the realized TradeOutcome. Identify exactly what the Head
Trader missed or overweighted. Write a concise critique with structured tags.`;
}
