import { z } from 'zod';

export const ToolCallRecordSchema = z.object({
  round: z.number().int(),
  toolName: z.string(),
  args: z.record(z.unknown()),
  result: z.unknown(),
  latencyMs: z.number().int(),
  errored: z.boolean(),
  errorMessage: z.string().nullable(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
