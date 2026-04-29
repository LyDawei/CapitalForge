import { z } from 'zod';
import { defineTool } from './types';

/**
 * Terminal tool. The head trader calls submit_decision exactly once to end the
 * deliberation; its args ARE the final TradePlan (minus reasoningTrace, which
 * the loop synthesizes from the rounds it walked through).
 *
 * This intentionally mirrors TradePlanSchema field-for-field but is duplicated
 * here so we can attach @description metadata that survives the JSON-Schema
 * conversion and shows up to the LLM.
 */
export const SubmitDecisionArgsSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'HOLD', 'CLOSE']).describe('The final decision.'),
  conviction: z.number().min(0).max(1).describe('0–1 confidence. Below 0.5 should produce HOLD.'),
  setupName: z
    .string()
    .nullable()
    .describe('Borrow from setupPattern specialist (e.g. pullback_to_sma20) when BUY; null otherwise.'),
  entry: z.number().describe('Entry price. For HOLD/CLOSE, use current close.'),
  stop: z.number().nullable().describe('Required below entry for BUY. Null for HOLD/CLOSE.'),
  target1: z.number().nullable().describe('First profit target above entry (typically ~1.5–2R). Null for HOLD/CLOSE.'),
  target2: z.number().nullable().describe('Runner target above entry (typically ~3R+). Null for HOLD/CLOSE.'),
  riskPctOfEquity: z
    .number()
    .min(0)
    .max(0.05)
    .describe('Risk fraction of equity, in [0, maxRiskPctPerTrade].'),
  timeStop: z.number().int().nullable().describe('Max bars in trade before exit at market. Null for HOLD/CLOSE.'),
  invalidationCriteria: z.array(z.string()).describe('Narrative kill-switches that should void the trade.'),
});

export const submitDecision = defineTool({
  name: 'submit_decision',
  description:
    'Terminal: emit the final trade plan and end deliberation. Call this exactly once when you are done thinking. Do not call it before you have considered kill criteria (catalysts, regime, momentum exhaustion, drawdown).',
  params: SubmitDecisionArgsSchema,
  terminal: true,
  execute: async (args) => args,
});
