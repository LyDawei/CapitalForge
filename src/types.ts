import { z } from 'zod';

// Technical data (stored as JSON in DailyCycle)
export interface TechnicalData {
  symbol: string;
  date: string;
  close: number;
  rsi: number;
  sma20: number;
  sma50: number;
  macdHistogram: number;
  volume: number;
  avgVolume: number;
}

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

// Agent output (zod validated)
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

// Sandbox context for risk decisions
export interface SandboxContext {
  allocatedCapital: number;
  currentEquity: number;
  peakEquity: number; // Track highest equity for drawdown
  cashBalance: number;
  positionQty: number;
  positionSymbol: string | null;
  positionAvgPrice: number | null;
  drawdownPct: number; // = (peakEquity - currentEquity) / peakEquity
}

// Decision type
export type Decision = 'BUY' | 'SELL' | 'HOLD';

// Risk check result
export interface RiskResult {
  allowed: boolean;
  reason?: string;
  quantity?: number; // Share quantity (not dollar value)
}

// Aggregation result
export interface AggregationResult {
  weightedScore: number;
  decision: Decision;
}

// Agent names
export type AgentName = 'momentum' | 'meanReversion' | 'confirmation' | 'newsEvents';

// News data types
export interface NewsArticle {
  headline: string;
  summary: string;
  source: string;
  createdAt: string;
  symbols: string[];
  url: string;
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface NewsData {
  articles: NewsArticle[];
  searchResults: WebSearchResult[];
  fetchedAt: string;
}

// Daily bar from Alpaca
export interface DailyBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Order from Alpaca
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

// Agent evaluation for persistence
export interface AgentEvaluationInput {
  cycleId: string;
  agentName: AgentName;
  promptVersion: string;
  bullishScore: number;
  confidence: number;
  rationale: string[];
  rawResponse: string;
}

// Cycle status
export type CycleStatus = 'pending' | 'completed' | 'failed';

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
