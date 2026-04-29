import type { Specialist, SpecialistContext } from './base';
import {
  formatTechnicalsBlock,
  formatPositionSummary,
  formatSandboxBlock,
  SPECIALIST_OUTPUT_INSTRUCTIONS,
} from './base';

export const NEWS_EVENTS_PROMPT_VERSION = 'v2.newsEvents.0.1.0';

function buildPrompt(ctx: SpecialistContext): string {
  return `[SPECIALIST=newsEvents]
You are the NEWS & EVENTS specialist. Identify catalysts, earnings windows, and the net sentiment direction.
If no meaningful news is available, you must return LOW confidence (0.1-0.3) and bullishScore near 0 — do
not invent a thesis.

Reason about:
- Imminent catalysts (earnings, FDA, macro prints) within the next 14 days
- Net sentiment from recent headlines/articles
- Whether any news contradicts the technical setup

TECHNICAL DATA (for grounding only — your edge is non-technical):
${formatTechnicalsBlock(ctx.technicals)}

CURRENT POSITION:
${formatPositionSummary(ctx.sandbox)}

SANDBOX:
${formatSandboxBlock(ctx.sandbox)}

Specialist-specific extras to include in the "extras" field:
- "catalystImminent": boolean — whether a catalyst is within 14 days
- "earningsWithinDays": integer or null — days until next earnings report
- "sentimentNet": number from -1 (very bearish) to +1 (very bullish)

${SPECIALIST_OUTPUT_INSTRUCTIONS}`;
}

export const newsEventsSpecialist: Specialist = {
  name: 'newsEvents',
  promptVersion: NEWS_EVENTS_PROMPT_VERSION,
  buildPrompt,
};
