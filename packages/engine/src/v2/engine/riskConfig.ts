import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../services/db';

/**
 * Effective risk + strategy config the engine reads at runtime. The DB ledger
 * is the source of truth (latest RiskConfig row); these defaults are what the
 * agents fall back to when the table is empty (i.e. a fresh install).
 */
export interface RiskConfigValues {
  riskTolerancePct: number;
  maxRiskPctPerTrade: number;
  maxConcurrentPositions: number;
  drawdownHalveAt: number;
  drawdownCloseOnlyAt: number;
  drawdownHardHaltAt: number;
  defaultStopLossPct: number;
  defaultTarget1R: number;
  defaultTarget2R: number;
  defaultTimeStopBars: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfigValues = {
  riskTolerancePct: 1.0,
  maxRiskPctPerTrade: 0.02,
  maxConcurrentPositions: 3,
  drawdownHalveAt: 0.10,
  drawdownCloseOnlyAt: 0.15,
  drawdownHardHaltAt: 0.20,
  defaultStopLossPct: 0.05,
  defaultTarget1R: 1.6,
  defaultTarget2R: 3.2,
  defaultTimeStopBars: 10,
};

export interface RiskConfigUpdateInput extends Partial<RiskConfigValues> {
  reason?: string;
  author?: string;
}

export async function getCurrentRiskConfig(
  prisma: PrismaClient = getPrismaClient()
): Promise<RiskConfigValues> {
  const row = await prisma.riskConfig.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!row) return { ...DEFAULT_RISK_CONFIG };
  return {
    riskTolerancePct: row.riskTolerancePct,
    maxRiskPctPerTrade: row.maxRiskPctPerTrade,
    maxConcurrentPositions: row.maxConcurrentPositions,
    drawdownHalveAt: row.drawdownHalveAt,
    drawdownCloseOnlyAt: row.drawdownCloseOnlyAt,
    drawdownHardHaltAt: row.drawdownHardHaltAt,
    defaultStopLossPct: row.defaultStopLossPct,
    defaultTarget1R: row.defaultTarget1R,
    defaultTarget2R: row.defaultTarget2R,
    defaultTimeStopBars: row.defaultTimeStopBars,
  };
}

export async function listRiskConfigHistory(
  prisma: PrismaClient = getPrismaClient(),
  limit = 50
) {
  return prisma.riskConfig.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Persist a new RiskConfig row. Unspecified fields inherit the current active
 * config (so the user can tweak just one knob without resetting the others).
 * Validates ranges to catch fat-fingered values before they reach the engine.
 */
export async function updateRiskConfig(
  input: RiskConfigUpdateInput,
  prisma: PrismaClient = getPrismaClient()
): Promise<RiskConfigValues & { id: string }> {
  const current = await getCurrentRiskConfig(prisma);
  const merged: RiskConfigValues = {
    riskTolerancePct: input.riskTolerancePct ?? current.riskTolerancePct,
    maxRiskPctPerTrade: input.maxRiskPctPerTrade ?? current.maxRiskPctPerTrade,
    maxConcurrentPositions: input.maxConcurrentPositions ?? current.maxConcurrentPositions,
    drawdownHalveAt: input.drawdownHalveAt ?? current.drawdownHalveAt,
    drawdownCloseOnlyAt: input.drawdownCloseOnlyAt ?? current.drawdownCloseOnlyAt,
    drawdownHardHaltAt: input.drawdownHardHaltAt ?? current.drawdownHardHaltAt,
    defaultStopLossPct: input.defaultStopLossPct ?? current.defaultStopLossPct,
    defaultTarget1R: input.defaultTarget1R ?? current.defaultTarget1R,
    defaultTarget2R: input.defaultTarget2R ?? current.defaultTarget2R,
    defaultTimeStopBars: input.defaultTimeStopBars ?? current.defaultTimeStopBars,
  };

  validateRiskConfig(merged);

  const row = await prisma.riskConfig.create({
    data: {
      ...merged,
      reason: input.reason,
      author: input.author,
    },
  });
  return { id: row.id, ...merged };
}

function validateRiskConfig(c: RiskConfigValues): void {
  const checks: Array<[boolean, string]> = [
    [c.riskTolerancePct >= 0 && c.riskTolerancePct <= 2, 'riskTolerancePct must be in [0, 2]'],
    [
      c.maxRiskPctPerTrade > 0 && c.maxRiskPctPerTrade <= 0.05,
      'maxRiskPctPerTrade must be in (0, 0.05]',
    ],
    [c.maxConcurrentPositions >= 1 && c.maxConcurrentPositions <= 20, 'maxConcurrentPositions must be in [1, 20]'],
    [c.drawdownHalveAt >= 0 && c.drawdownHalveAt <= 0.5, 'drawdownHalveAt must be in [0, 0.5]'],
    [
      c.drawdownCloseOnlyAt >= c.drawdownHalveAt && c.drawdownCloseOnlyAt <= 0.5,
      'drawdownCloseOnlyAt must be in [drawdownHalveAt, 0.5]',
    ],
    [
      c.drawdownHardHaltAt >= c.drawdownCloseOnlyAt && c.drawdownHardHaltAt <= 1.0,
      'drawdownHardHaltAt must be in [drawdownCloseOnlyAt, 1.0]',
    ],
    [
      c.defaultStopLossPct > 0 && c.defaultStopLossPct <= 0.5,
      'defaultStopLossPct must be in (0, 0.5]',
    ],
    [c.defaultTarget1R >= 0.5 && c.defaultTarget1R <= 10, 'defaultTarget1R must be in [0.5, 10]'],
    [
      c.defaultTarget2R >= c.defaultTarget1R && c.defaultTarget2R <= 20,
      'defaultTarget2R must be in [defaultTarget1R, 20]',
    ],
    [
      c.defaultTimeStopBars >= 1 && c.defaultTimeStopBars <= 100,
      'defaultTimeStopBars must be in [1, 100]',
    ],
  ];
  const failures = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (failures.length > 0) {
    throw new Error(`Invalid risk config: ${failures.join('; ')}`);
  }
}
