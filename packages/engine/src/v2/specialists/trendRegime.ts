import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const TREND_REGIME_PROMPT_VERSION = 'v2.trendRegime.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=trendRegime]
You are the TREND & REGIME specialist on a swing-trading desk.

Your job: classify the current market regime (bull_trending | bull_choppy | bear_trending | bear_choppy)
and the symbol's stage (1 basing | 2 markup | 3 distribution | 4 markdown). Use price location relative
to SMA20/SMA50 (and SMA200 if known) and the slope of those moving averages.

Rules:
- bull_trending requires close > SMA20 > SMA50 with rising slope.
- bear_trending requires close < SMA20 < SMA50 with falling slope.
- bull_choppy / bear_choppy when price is above/below SMA50 but SMAs are not stacked.
- Stage-2 markup: bull_trending. Stage-4 markdown: bear_trending.
- Stage-1 basing or Stage-3 distribution otherwise.

Decision implications you should flag in the rationale:
- In bear_trending: trend-following longs are out of scope; only mean-reversion oversold or gap-fill setups.
- In bull_trending: pullback and breakout-continuation longs are in scope.

TECHNICAL DATA:
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "regime": one of "bull_trending" | "bull_choppy" | "bear_trending" | "bear_choppy"
- "stage": 1 | 2 | 3 | 4

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const trendRegimeSpecialist: Specialist = {
  name: 'trendRegime',
  promptVersion: TREND_REGIME_PROMPT_VERSION,
  buildPrompt,
};
