import { z } from 'zod';
import type { Decision as SharedDecision, AgentName as SharedAgentName } from '@capitalforge/shared';

// Re-export cross-boundary types from shared package
export {
  TechnicalDataSchema,
  type TechnicalData,
  SandboxContextSchema,
  type SandboxContext,
  NewsArticleSchema,
  type NewsArticle,
  WebSearchResultSchema,
  type WebSearchResult,
  NewsDataSchema,
  type NewsData,
  DecisionSchema,
  type Decision,
  AgentNameSchema,
  type AgentName,
  CycleStatusSchema,
  type CycleStatus,
} from '@capitalforge/shared';

// V1 agent output (engine-internal LLM contract — will be removed when V1 is deleted)
export interface AgentOutput {
  bullishScore: number; // -1 to +1
  confidence: number; // 0 to 1
  rationale: string[];
}

export const AgentOutputSchema = z.object({
  bullishScore: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string()),
});

// Risk check result (engine-internal)
export interface RiskResult {
  allowed: boolean;
  reason?: string;
  quantity?: number; // Share quantity (not dollar value)
}

// Aggregation result (engine-internal — V1)
export interface AggregationResult {
  weightedScore: number;
  decision: SharedDecision;
}

// Daily bar from Alpaca (engine-internal)
export interface DailyBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Order from Alpaca (engine-internal)
export interface AlpacaOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  filledQty?: number;
  filledAvgPrice?: number;
  status: string;
  createdAt: string;
  filledAt?: string;
}

// Position from Alpaca (engine-internal)
export interface AlpacaPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice?: number;
  marketValue?: number;
  costBasis?: number;
  side?: 'long' | 'short';
}

// Agent evaluation for persistence (engine-internal)
export interface AgentEvaluationInput {
  cycleId: string;
  agentName: SharedAgentName;
  promptVersion: string;
  bullishScore: number;
  confidence: number;
  rationale: string[];
  rawResponse: string;
}

// Drawdown calculation (deterministic)
export function calculateDrawdown(currentEquity: number, peakEquity: number): number {
  if (peakEquity === 0) return 0;
  return (peakEquity - currentEquity) / peakEquity;
}

// Peak equity update (monotonic increase)
export function updatePeakEquity(currentEquity: number, previousPeak: number): number {
  return Math.max(currentEquity, previousPeak);
}

// Format date as YYYY-MM-DD
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get today's date in YYYY-MM-DD format
export function getTodayDate(): string {
  return formatDate(new Date());
}
