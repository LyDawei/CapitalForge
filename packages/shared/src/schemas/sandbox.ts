import { z } from 'zod';

export const SandboxContextSchema = z.object({
  allocatedCapital: z.number(),
  currentEquity: z.number(),
  peakEquity: z.number(),
  cashBalance: z.number(),
  positionQty: z.number(),
  positionSymbol: z.string().nullable(),
  positionAvgPrice: z.number().nullable(),
  drawdownPct: z.number(),
});

export type SandboxContext = z.infer<typeof SandboxContextSchema>;
