import { z } from 'zod';

export const ReasoningStepSchema = z.object({
  round: z.number().int(),
  thought: z.string(),
  toolUsed: z.string().nullable(),
});
export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;

export const DeliberationSummarySchema = z.object({
  rounds: z.number().int(),
  finalAction: z.enum(['BUY', 'SELL', 'HOLD', 'CLOSE']),
  conviction: z.number().min(0).max(1),
  totalLatencyMs: z.number().int(),
  totalTokens: z.number().int().nullable(),
  modelName: z.string(),
  promptVersion: z.string(),
  reasoningTrace: z.array(ReasoningStepSchema),
});
export type DeliberationSummary = z.infer<typeof DeliberationSummarySchema>;
