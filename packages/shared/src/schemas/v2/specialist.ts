import { z } from 'zod';

export const SpecialistFlagSchema = z.enum([
  'overbought',
  'oversold',
  'breakout',
  'breakdown',
  'pullback',
  'base',
  'gap',
  'volume_surge',
  'volume_dry',
  'earnings_window',
  'macro_event',
  'rsi_divergence',
]);
export type SpecialistFlag = z.infer<typeof SpecialistFlagSchema>;

export const SpecialistKeyLevelsSchema = z.object({
  support: z.number().nullable(),
  resistance: z.number().nullable(),
});
export type SpecialistKeyLevels = z.infer<typeof SpecialistKeyLevelsSchema>;

export const SpecialistOutputSchema = z.object({
  bullishScore: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string()).min(2).max(6),
  keyLevels: SpecialistKeyLevelsSchema.optional(),
  flags: z.array(SpecialistFlagSchema).default([]),
  extras: z.record(z.unknown()).optional(),
});
export type SpecialistOutput = z.infer<typeof SpecialistOutputSchema>;
