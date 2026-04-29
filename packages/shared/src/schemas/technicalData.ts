import { z } from 'zod';

export const TechnicalDataSchema = z.object({
  symbol: z.string(),
  date: z.string(),
  close: z.number(),
  rsi: z.number(),
  sma20: z.number(),
  sma50: z.number(),
  macdHistogram: z.number(),
  volume: z.number(),
  avgVolume: z.number(),
});

export type TechnicalData = z.infer<typeof TechnicalDataSchema>;
