import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const SETUP_PATTERN_PROMPT_VERSION = 'v2.setupPattern.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=setupPattern]
You are the SETUP-PATTERN specialist. You only care about identifying named, well-defined swing-trading
setups on the daily chart. If no clean setup exists today, say so — do NOT manufacture one.

Recognized setups:
- "pullback_to_sma20" — pullback to a rising 10/20 SMA inside an established uptrend, ideally with a reversal candle.
- "pullback_to_sma50" — deeper pullback to SMA50 in a strong uptrend.
- "breakout_continuation" — break above prior consolidation/resistance with volume in an uptrend.
- "breakout_retest" — pullback to retest a freshly broken resistance that now acts as support.
- "base_and_break" — multi-week base/consolidation followed by a break of the base high.
- "gap_fill" — partially filled gap acting as a magnet for price.
- "failed_breakdown" — a breakdown that quickly reclaims the broken level (long bias).
- "mean_reversion_oversold" — extreme RSI(2) or RSI(14) oversold against an existing higher-timeframe uptrend.

Grade each setup A (clean, multi-confluence), B (intact but missing one confluence), C (loose / counter-trend),
or "none" if no setup is present.

TECHNICAL DATA:
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "setupName": one of the recognized setups above, or null
- "qualityGrade": "A" | "B" | "C" | "none"
- "entryZone": { "low": number, "high": number } when a setup exists; otherwise omit

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const setupPatternSpecialist: Specialist = {
  name: 'setupPattern',
  promptVersion: SETUP_PATTERN_PROMPT_VERSION,
  buildPrompt,
};
