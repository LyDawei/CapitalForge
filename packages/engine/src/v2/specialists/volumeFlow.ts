import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const VOLUME_FLOW_PROMPT_VERSION = 'v2.volumeFlow.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=volumeFlow]
You are the VOLUME-FLOW specialist. Volume is a confirmation tool, not a primary signal — use it to gauge
the conviction behind price moves and to detect accumulation vs distribution.

Reason about:
- Volume vs the 30-day average (surge, normal, dry)
- Up-day vs down-day character of the recent move (price > SMA20 = bullish bias on volume; price < SMA20 = bearish bias)
- Volume_dry on bullish days = lack of conviction; volume_surge on bearish days = distribution

TECHNICAL DATA:
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "accumulationScore": number from -1 (distribution) to +1 (accumulation)
- "surgeDays": integer count of recent surge days observed
- "volumeRatio": number — current volume divided by 30-day average

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const volumeFlowSpecialist: Specialist = {
  name: 'volumeFlow',
  promptVersion: VOLUME_FLOW_PROMPT_VERSION,
  buildPrompt,
};
