import { z } from 'zod';
import type { Decision as SharedDecision, AgentName as SharedAgentName } from '@capitalforge/shared';
export { TechnicalDataSchema, type TechnicalData, SandboxContextSchema, type SandboxContext, NewsArticleSchema, type NewsArticle, WebSearchResultSchema, type WebSearchResult, NewsDataSchema, type NewsData, DecisionSchema, type Decision, AgentNameSchema, type AgentName, CycleStatusSchema, type CycleStatus, } from '@capitalforge/shared';
export interface AgentOutput {
    bullishScore: number;
    confidence: number;
    rationale: string[];
}
export declare const AgentOutputSchema: z.ZodObject<{
    bullishScore: z.ZodNumber;
    confidence: z.ZodNumber;
    rationale: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    bullishScore: number;
    confidence: number;
    rationale: string[];
}, {
    bullishScore: number;
    confidence: number;
    rationale: string[];
}>;
export interface RiskResult {
    allowed: boolean;
    reason?: string;
    quantity?: number;
}
export interface AggregationResult {
    weightedScore: number;
    decision: SharedDecision;
}
export interface DailyBar {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
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
export interface AlpacaPosition {
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice?: number;
    marketValue?: number;
    costBasis?: number;
    side?: 'long' | 'short';
}
export interface AgentEvaluationInput {
    cycleId: string;
    agentName: SharedAgentName;
    promptVersion: string;
    bullishScore: number;
    confidence: number;
    rationale: string[];
    rawResponse: string;
}
export declare function calculateDrawdown(currentEquity: number, peakEquity: number): number;
export declare function updatePeakEquity(currentEquity: number, previousPeak: number): number;
export declare function formatDate(date: Date): string;
export declare function getTodayDate(): string;
//# sourceMappingURL=types.d.ts.map