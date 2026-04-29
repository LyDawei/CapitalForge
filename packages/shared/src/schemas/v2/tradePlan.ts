import { z } from 'zod';

export const TradeActionSchema = z.enum(['BUY', 'SELL', 'HOLD', 'CLOSE']);
export type TradeAction = z.infer<typeof TradeActionSchema>;

export const TradePlanStatusSchema = z.enum([
  'proposed',
  'active',
  'closed',
  'cancelled',
  'invalidated',
]);
export type TradePlanStatus = z.infer<typeof TradePlanStatusSchema>;

export const TradePlanSchema = z.object({
  action: TradeActionSchema,
  conviction: z.number().min(0).max(1),
  setupName: z.string().nullable(),
  entry: z.number(),
  stop: z.number().nullable(),
  target1: z.number().nullable(),
  target2: z.number().nullable(),
  riskPctOfEquity: z.number().min(0).max(0.02),
  timeStop: z.number().int().nullable(),
  invalidationCriteria: z.array(z.string()),
  reasoningTrace: z.array(
    z.object({
      round: z.number().int(),
      thought: z.string(),
      toolUsed: z.string().nullable(),
    })
  ),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;
