import { PrismaClient } from '@prisma/client';
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
    prismaInstance = new PrismaClient();
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
  technicalData: TechnicalData
): Promise<string> {
  const prisma = getPrismaClient();
  const cycle = await prisma.dailyCycle.create({
    data: {
      date,
      symbol,
      technicalData: technicalData as object,
      status: 'pending',
    },
  });
  return cycle.id;
}

export async function getDailyCycleByDate(date: string) {
  const prisma = getPrismaClient();
  return prisma.dailyCycle.findUnique({
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
