import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  TechnicalData,
  AgentEvaluationInput,
  Decision,
  SandboxContext,
  CycleStatus,
} from '../types';

// Singleton Prisma client
let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const adapter = new PrismaPg({connectionString});
    prismaInstance = new PrismaClient({ adapter });
  }
  return prismaInstance;
}

// For testing - allows resetting the client
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

// Database operations

export async function createDailyCycle(
  date: string,
  symbol: string,
  technicalData: TechnicalData,
  engineVersion: 'v1' | 'v2' = 'v1'
): Promise<string> {
  const prisma = getPrismaClient();
  const cycle = await prisma.dailyCycle.create({
    data: {
      date,
      symbol,
      technicalData: technicalData as object,
      status: 'pending',
      engineVersion,
    },
  });
  return cycle.id;
}

export interface SpecialistAnalysisInput {
  cycleId: string;
  specialistName: string;
  promptVersion: string;
  bullishScore: number;
  confidence: number;
  rationale: string[];
  flags: string[];
  keyLevels?: { support: number | null; resistance: number | null } | null;
  extras?: Record<string, unknown> | null;
  rawResponse: string;
}

export async function createSpecialistAnalysis(
  input: SpecialistAnalysisInput
): Promise<string> {
  const prisma = getPrismaClient();
  const row = await prisma.specialistAnalysis.create({
    data: {
      cycleId: input.cycleId,
      specialistName: input.specialistName,
      promptVersion: input.promptVersion,
      bullishScore: input.bullishScore,
      confidence: input.confidence,
      rationale: input.rationale,
      flags: input.flags,
      keyLevels: input.keyLevels ?? undefined,
      extras: (input.extras ?? undefined) as object | undefined,
      rawResponse: input.rawResponse,
    },
  });
  return row.id;
}

export async function getDailyCycleByDate(date: string, symbol?: string) {
  const prisma = getPrismaClient();
  if (symbol) {
    // Use findFirst with compound where clause until Prisma client is regenerated
    // After migration, this can be changed to findUnique with date_symbol: { date, symbol }
    return prisma.dailyCycle.findFirst({
      where: { 
        date,
        symbol,
      },
      include: {
        evaluations: true,
        decision: true,
        trade: true,
      },
    });
  }
  // Legacy: if no symbol provided, find first cycle for that date (for backward compatibility)
  return prisma.dailyCycle.findFirst({
    where: { date },
    include: {
      evaluations: true,
      decision: true,
      trade: true,
    },
  });
}

export async function updateCycleStatus(cycleId: string, status: CycleStatus): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.dailyCycle.update({
    where: { id: cycleId },
    data: { status },
  });
}

export async function createAgentEvaluation(input: AgentEvaluationInput): Promise<string> {
  const prisma = getPrismaClient();
  const evaluation = await prisma.agentEvaluation.create({
    data: {
      cycleId: input.cycleId,
      agentName: input.agentName,
      promptVersion: input.promptVersion,
      bullishScore: input.bullishScore,
      confidence: input.confidence,
      rationale: input.rationale,
      rawResponse: input.rawResponse,
    },
  });
  return evaluation.id;
}

export async function createAggregatedDecision(
  cycleId: string,
  weightedScore: number,
  decision: Decision,
  riskBlocked: boolean,
  riskReason?: string
): Promise<string> {
  const prisma = getPrismaClient();
  const aggregated = await prisma.aggregatedDecision.create({
    data: {
      cycleId,
      weightedScore,
      decision,
      riskBlocked,
      riskReason,
    },
  });
  return aggregated.id;
}

export async function createTrade(
  cycleId: string,
  alpacaOrderId: string,
  side: 'buy' | 'sell',
  symbol: string,
  quantity: number
): Promise<string> {
  const prisma = getPrismaClient();
  const trade = await prisma.trade.create({
    data: {
      cycleId,
      alpacaOrderId,
      side,
      symbol,
      quantity,
      status: 'pending',
    },
  });
  return trade.id;
}

export async function updateTradeStatus(
  tradeId: string,
  status: string,
  filledPrice?: number,
  filledAt?: Date
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status,
      filledPrice,
      filledAt,
    },
  });
}

export async function getLatestSandboxState(): Promise<SandboxContext | null> {
  const prisma = getPrismaClient();
  const state = await prisma.sandboxState.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!state) return null;

  return {
    allocatedCapital: state.allocatedCapital,
    currentEquity: state.currentEquity,
    peakEquity: state.peakEquity,
    cashBalance: state.cashBalance,
    positionQty: state.positionQty,
    positionSymbol: state.positionSymbol,
    positionAvgPrice: state.positionAvgPrice,
    drawdownPct: state.drawdownPct,
  };
}

export async function createSandboxState(
  date: string,
  sandbox: SandboxContext
): Promise<string> {
  const prisma = getPrismaClient();
  const state = await prisma.sandboxState.create({
    data: {
      date,
      allocatedCapital: sandbox.allocatedCapital,
      currentEquity: sandbox.currentEquity,
      peakEquity: sandbox.peakEquity,
      cashBalance: sandbox.cashBalance,
      positionQty: sandbox.positionQty,
      positionSymbol: sandbox.positionSymbol,
      positionAvgPrice: sandbox.positionAvgPrice,
      drawdownPct: sandbox.drawdownPct,
    },
  });
  return state.id;
}

/**
 * Save a sandbox snapshot. Each symbol's cycle creates a new snapshot so the
 * most recent record always reflects the true portfolio state. This is safe
 * now that date is no longer @unique.
 */
export async function saveSandboxSnapshot(
  date: string,
  sandbox: SandboxContext
): Promise<string> {
  return createSandboxState(date, sandbox);
}

export async function getOrCreatePromptVersion(
  agentName: string,
  version: string,
  template: string
): Promise<string> {
  const prisma = getPrismaClient();
  const existing = await prisma.promptVersion.findUnique({
    where: {
      agentName_version: { agentName, version },
    },
  });

  if (existing) return existing.id;

  const created = await prisma.promptVersion.create({
    data: { agentName, version, template },
  });
  return created.id;
}

export async function getPromptVersion(agentName: string, version: string) {
  const prisma = getPrismaClient();
  return prisma.promptVersion.findUnique({
    where: {
      agentName_version: { agentName, version },
    },
  });
}

// ============================================================================
// V2 — Deliberation + TradePlan
// ============================================================================

export interface DeliberationInput {
  cycleId: string;
  symbol: string;
  rounds: number;
  finalAction: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';
  conviction: number;
  totalLatencyMs: number;
  totalTokens?: number | null;
  modelName: string;
  promptVersion: string;
  reasoningTrace: Array<{ round: number; thought: string; toolUsed: string | null }>;
}

export async function createDeliberation(input: DeliberationInput): Promise<string> {
  const prisma = getPrismaClient();
  const row = await prisma.deliberation.create({
    data: {
      cycleId: input.cycleId,
      symbol: input.symbol,
      rounds: input.rounds,
      finalAction: input.finalAction,
      conviction: input.conviction,
      totalLatencyMs: input.totalLatencyMs,
      totalTokens: input.totalTokens ?? null,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      reasoningTrace: input.reasoningTrace as object,
    },
  });
  return row.id;
}

export interface TradePlanInput {
  cycleId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';
  setupName: string | null;
  entry: number;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskPctOfEquity: number;
  riskDollars: number;
  shares: number;
  conviction: number;
  timeStopBars: number | null;
  invalidationCriteria: string[];
  status: 'proposed' | 'active' | 'closed' | 'cancelled' | 'invalidated';
  closeReason?: string | null;
}

export interface ToolCallInput {
  deliberationId: string;
  round: number;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  latencyMs: number;
  errored: boolean;
  errorMessage: string | null;
}

export async function createToolCall(input: ToolCallInput): Promise<string> {
  const prisma = getPrismaClient();
  const row = await prisma.toolCall.create({
    data: {
      deliberationId: input.deliberationId,
      round: input.round,
      toolName: input.toolName,
      args: input.args as object,
      result: (input.result ?? null) as object,
      latencyMs: input.latencyMs,
      errored: input.errored,
      errorMessage: input.errorMessage,
    },
  });
  return row.id;
}

export async function createTradePlan(input: TradePlanInput): Promise<string> {
  const prisma = getPrismaClient();
  const row = await prisma.tradePlan.create({
    data: {
      cycleId: input.cycleId,
      symbol: input.symbol,
      action: input.action,
      setupName: input.setupName,
      entry: input.entry,
      stop: input.stop,
      target1: input.target1,
      target2: input.target2,
      riskPctOfEquity: input.riskPctOfEquity,
      riskDollars: input.riskDollars,
      shares: input.shares,
      conviction: input.conviction,
      timeStopBars: input.timeStopBars,
      invalidationCriteria: input.invalidationCriteria,
      status: input.status,
      closeReason: input.closeReason ?? null,
    },
  });
  return row.id;
}

