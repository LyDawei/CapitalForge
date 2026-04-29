import { z } from 'zod';

export const DecisionSchema = z.enum(['BUY', 'SELL', 'HOLD']);
export type Decision = z.infer<typeof DecisionSchema>;

export const CycleStatusSchema = z.enum(['pending', 'completed', 'failed']);
export type CycleStatus = z.infer<typeof CycleStatusSchema>;

export const AgentNameSchema = z.enum([
  'momentum',
  'meanReversion',
  'confirmation',
  'newsEvents',
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const SpecialistNameSchema = z.enum([
  'trendRegime',
  'setupPattern',
  'momentum',
  'meanReversion',
  'volumeFlow',
  'newsEvents',
]);
export type SpecialistName = z.infer<typeof SpecialistNameSchema>;

export const TradeSideSchema = z.enum(['buy', 'sell']);
export type TradeSide = z.infer<typeof TradeSideSchema>;
