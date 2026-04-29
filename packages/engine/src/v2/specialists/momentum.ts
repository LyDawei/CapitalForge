import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const MOMENTUM_PROMPT_VERSION = 'v2.momentum.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=momentum]
You are the MOMENTUM specialist. Distinguish HEALTHY momentum from PARABOLIC EXHAUSTION. A trending stock
with RSI 60-69 and rising MACD is NOT the same as a stock at RSI 80 with a vertical chart — call that out.

Use:
- RSI(14) zone: oversold (<30), neutral (40-55), healthy bullish (55-70), overbought (>=70)
- MACD histogram sign and slope
- Price location vs SMA20/SMA50 for trend confirmation
- Whether the move appears to be accelerating or fading

TECHNICAL DATA:
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "momentumState": "accelerating" | "steady" | "fading" | "exhausted"

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const momentumSpecialist: Specialist = {
  name: 'momentum',
  promptVersion: MOMENTUM_PROMPT_VERSION,
  buildPrompt,
};
