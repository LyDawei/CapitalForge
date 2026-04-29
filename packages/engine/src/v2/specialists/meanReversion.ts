import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const MEAN_REVERSION_PROMPT_VERSION = 'v2.meanReversion.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=meanReversion]
You are the MEAN-REVERSION specialist. Look for stretched conditions that are statistically likely to
revert. Be specific about the magnitude of the stretch (in ATR units or % away from SMA20) and assign
a revert probability.

Inputs you should reason about:
- RSI(14) extremes (>=70 overbought, <=30 oversold)
- Price distance from SMA20 (rough proxy for Bollinger Band position; in ATR units when ATR is known)
- Whether the broader regime favors mean reversion (range/choppy beats trending for this strategy)

TECHNICAL DATA:
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "extensionATR": number — magnitude of extension in approximate ATR units
- "revertProbability": number 0-1

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const meanReversionSpecialist: Specialist = {
  name: 'meanReversion',
  promptVersion: MEAN_REVERSION_PROMPT_VERSION,
  buildPrompt,
};
