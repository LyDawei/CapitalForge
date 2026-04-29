import type { SandboxContext, TechnicalData } from '@capitalforge/shared';
import type { SpecialistRunResult } from '../specialists';
import { DEFAULT_RISK_CONFIG, type RiskConfigValues } from '../engine/riskConfig';

export const HEAD_TRADER_PROMPT_VERSION = 'v2.headTrader.0.3.0-tool-using';

export interface HeadTraderPromptContext {
  symbol: string;
  technicals: TechnicalData;
  sandbox: SandboxContext;
  specialists: SpecialistRunResult[];
  /** Live risk config; defaults to baseline when not supplied. */
  riskConfig?: RiskConfigValues;
}

interface HeadTraderMeta {
  weightedScore: number;
  regime: string | null;
  setupName: string | null;
  qualityGrade: string | null;
  momentumState: string | null;
  drawdownPct: number;
  hasPosition: boolean;
  catalystImminent: boolean;
  earningsWithinDays: number | null;
  flagsUnion: string[];
  /** Live risk config — agents must respect these knobs. */
  config: {
    riskTolerancePct: number;
    maxRiskPctPerTrade: number;
    drawdownHalveAt: number;
    drawdownCloseOnlyAt: number;
    drawdownHardHaltAt: number;
    defaultStopLossPct: number;
    defaultTarget1R: number;
    defaultTarget2R: number;
    defaultTimeStopBars: number;
  };
}

/**
 * Compute machine-readable summary of specialist outputs that the head-trader
 * mock LLM can parse, while still being useful (non-leaky) context for a real LLM.
 */
export function computeMeta(ctx: HeadTraderPromptContext): HeadTraderMeta {
  const { specialists, sandbox, riskConfig } = ctx;
  const config = riskConfig ?? DEFAULT_RISK_CONFIG;

  const weightedScore = computeWeightedScore(specialists);
  const trendRegime = specialists.find((s) => s.name === 'trendRegime');
  const setupPattern = specialists.find((s) => s.name === 'setupPattern');
  const momentum = specialists.find((s) => s.name === 'momentum');
  const newsEvents = specialists.find((s) => s.name === 'newsEvents');

  const flagsUnion = Array.from(
    new Set(specialists.flatMap((s) => s.output.flags as string[]))
  );

  return {
    weightedScore,
    regime: extra(trendRegime, 'regime') as string | null,
    setupName: extra(setupPattern, 'setupName') as string | null,
    qualityGrade: extra(setupPattern, 'qualityGrade') as string | null,
    momentumState: extra(momentum, 'momentumState') as string | null,
    drawdownPct: sandbox.drawdownPct,
    hasPosition: sandbox.positionQty > 0,
    catalystImminent: Boolean(extra(newsEvents, 'catalystImminent')),
    earningsWithinDays: (extra(newsEvents, 'earningsWithinDays') as number | null) ?? null,
    flagsUnion,
    config: {
      riskTolerancePct: config.riskTolerancePct,
      maxRiskPctPerTrade: config.maxRiskPctPerTrade,
      drawdownHalveAt: config.drawdownHalveAt,
      drawdownCloseOnlyAt: config.drawdownCloseOnlyAt,
      drawdownHardHaltAt: config.drawdownHardHaltAt,
      defaultStopLossPct: config.defaultStopLossPct,
      defaultTarget1R: config.defaultTarget1R,
      defaultTarget2R: config.defaultTarget2R,
      defaultTimeStopBars: config.defaultTimeStopBars,
    },
  };
}

function extra(
  result: SpecialistRunResult | undefined,
  key: string
): unknown {
  if (!result || !result.output.extras) return null;
  return (result.output.extras as Record<string, unknown>)[key] ?? null;
}

function computeWeightedScore(specialists: SpecialistRunResult[]): number {
  const totalWeight = specialists.reduce((sum, s) => sum + s.output.confidence, 0);
  if (totalWeight === 0) return 0;
  const weighted = specialists.reduce(
    (sum, s) => sum + s.output.bullishScore * s.output.confidence,
    0
  );
  return weighted / totalWeight;
}

function formatSpecialistReport(s: SpecialistRunResult): string {
  const flags = (s.output.flags as string[]).join(', ') || '(none)';
  const extras = s.output.extras
    ? `  extras: ${JSON.stringify(s.output.extras)}`
    : '';
  const rationale = s.output.rationale.map((r) => `    - ${r}`).join('\n');
  return `[${s.name}] score=${s.output.bullishScore.toFixed(2)} conf=${s.output.confidence.toFixed(2)} flags=[${flags}]
${extras}
  rationale:
${rationale}`;
}

function formatPosition(sandbox: SandboxContext): string {
  if (sandbox.positionQty === 0) return 'flat (no open position)';
  return `holding ${sandbox.positionQty} shares of ${sandbox.positionSymbol} @ avg $${sandbox.positionAvgPrice?.toFixed(2)}`;
}

export function buildHeadTraderPrompt(ctx: HeadTraderPromptContext): string {
  const meta = computeMeta(ctx);
  const reports = ctx.specialists.map(formatSpecialistReport).join('\n\n');

  return `[HEAD_TRADER]
META: ${JSON.stringify(meta)}

You are the HEAD TRADER on a swing-trading desk. Six specialists have already analyzed today's setup.
Your job is to make ONE final decision, with a complete trade plan if you choose to act.

DECISION OPTIONS:
- BUY: open a new long position. Requires: no existing open position, a stop, a setup name. Capped at 2% risk of equity.
- HOLD: do nothing today. The right call when conviction is below 0.5 or evidence is conflicting.
- CLOSE: close the existing open position (only valid if a position is held).
- SELL: this desk does not short — translate bearish theses on no position into HOLD.

KILL CRITERIA — choose HOLD or CLOSE if any apply:
- newsEvents reports a catalyst within 2 days (catalystImminent=true AND earningsWithinDays <= 2).
- trendRegime is bear_trending AND setupName is NOT one of: mean_reversion_oversold, gap_fill, failed_breakdown.
- momentum is "exhausted" AND has the "overbought" flag.
- drawdownPct >= 0.15 (close-only mode; do not open new positions).
- conviction would be below 0.5.

CONVICTION GUIDE:
- < 0.5  → HOLD
- 0.5 - 0.7  → light risk (~0.5% of equity)
- 0.7 - 0.85 → standard risk (~1% of equity)
- > 0.85     → high risk (~1.5% of equity, capped at maxRiskPctPerTrade)

SIZING RULES (must satisfy — read from META.config above):
- riskPctOfEquity in [0, ${(meta.config.maxRiskPctPerTrade * 100).toFixed(2)}%]
- For BUY: stop must be a number BELOW entry; target1 must be ABOVE entry
- Default stop distance is ${(meta.config.defaultStopLossPct * 100).toFixed(1)}% below entry; deviate only if a structural level argues otherwise.
- Aim for target1 ~ ${meta.config.defaultTarget1R}R and target2 ~ ${meta.config.defaultTarget2R}R where R = entry - stop.
- Default time stop: ${meta.config.defaultTimeStopBars} bars.
- The system layer will scale your emitted risk by ${(meta.config.riskTolerancePct * 100).toFixed(0)}% (riskTolerancePct) — emit your honest sizing; do not pre-scale.

SPECIALIST REPORTS:
${reports}

MARKET CONTEXT:
- Symbol: ${ctx.symbol}
- Date: ${ctx.technicals.date}
- Close: $${ctx.technicals.close.toFixed(2)}
- Sandbox equity: $${ctx.sandbox.currentEquity.toFixed(2)}
- Cash available: $${ctx.sandbox.cashBalance.toFixed(2)}
- Drawdown: ${(ctx.sandbox.drawdownPct * 100).toFixed(1)}%
- Open position: ${formatPosition(ctx.sandbox)}

Respond with JSON ONLY, matching this exact shape:
{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "conviction": <number 0-1>,
  "setupName": <string or null>,
  "entry": <number>,
  "stop": <number or null>,
  "target1": <number or null>,
  "target2": <number or null>,
  "riskPctOfEquity": <number 0-0.02>,
  "timeStop": <integer or null>,
  "invalidationCriteria": ["<criterion>", ...],
  "reasoningTrace": [{ "round": 1, "thought": "<one to four sentences>", "toolUsed": null }]
}`;
}
