import { PrismaClient, TradePlan as TradePlanRow } from '@prisma/client';
import type { SandboxContext } from '@capitalforge/shared';
import { AlpacaService } from '../../services/alpaca';
import { DailyBar } from '../../types';

export const TRADE_PLAN_LIFECYCLE_VERSION = 'v2.lifecycle.0.2.0';

export type CloseReason = 'stop_hit' | 'target_hit' | 'time_stop' | 'discretionary' | 'regime_change';

export interface CloseEvent {
  planId: string;
  symbol: string;
  shares: number;
  entry: number;
  exitPrice: number;
  exitTimestamp: string | null;
  closeReason: CloseReason;
  realizedPnl: number;
  rMultiple: number;
}

/**
 * Pure: given a plan and the bars that occurred AFTER the plan opened, return
 * the first stop/target/time-stop hit, or null if none yet.
 *
 * If both stop and target are hit on the same bar, conservatively assume stop
 * hit first (path-dependent worst-case for the trader).
 */
export function detectExit(
  plan: { stop: number | null; target1: number | null; entry: number; timeStopBars: number | null },
  bars: DailyBar[],
  defaultTimeStop = 10
): { exitPrice: number; closeReason: 'stop_hit' | 'target_hit' | 'time_stop'; exitTimestamp: string } | null {
  if (plan.stop === null) return null;
  const timeStop = plan.timeStopBars ?? defaultTimeStop;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const stopHit = bar.low <= plan.stop;
    const targetHit = plan.target1 !== null && bar.high >= plan.target1;
    if (stopHit) {
      return { exitPrice: plan.stop, closeReason: 'stop_hit', exitTimestamp: bar.timestamp };
    }
    if (targetHit && plan.target1 !== null) {
      return { exitPrice: plan.target1, closeReason: 'target_hit', exitTimestamp: bar.timestamp };
    }
    if (i + 1 >= timeStop) {
      // Time-stop fires AT the bar where i+1 reaches the limit (close at that bar)
      return { exitPrice: bar.close, closeReason: 'time_stop', exitTimestamp: bar.timestamp };
    }
  }
  return null;
}

/**
 * Mutate the sandbox to reflect a position close. Cash is credited with the
 * proceeds; position fields are cleared if this plan held the wallet's only
 * position. Returns a NEW SandboxContext (does not mutate input).
 */
export function applyCloseToSandbox(
  sandbox: SandboxContext,
  symbol: string,
  shares: number,
  exitPrice: number
): SandboxContext {
  const proceeds = shares * exitPrice;
  const heldThis = sandbox.positionSymbol === symbol;
  return {
    ...sandbox,
    cashBalance: sandbox.cashBalance + proceeds,
    positionQty: heldThis ? 0 : sandbox.positionQty,
    positionSymbol: heldThis ? null : sandbox.positionSymbol,
    positionAvgPrice: heldThis ? null : sandbox.positionAvgPrice,
  };
}

/**
 * Mutate the sandbox to reflect a new position opening. Debits cash; populates
 * position fields. Caller should have already verified there's no other open
 * position.
 */
export function applyOpenToSandbox(
  sandbox: SandboxContext,
  symbol: string,
  shares: number,
  entry: number
): SandboxContext {
  const cost = shares * entry;
  return {
    ...sandbox,
    cashBalance: sandbox.cashBalance - cost,
    positionQty: shares,
    positionSymbol: symbol,
    positionAvgPrice: entry,
  };
}

/**
 * Walk every active plan for `symbol` forward through subsequent bars, settling
 * any that hit stop/target/time-stop. Persists closes to the DB and returns
 * the updated sandbox plus a list of close events for logging.
 */
export async function settleOpenPlansForSymbol(
  symbol: string,
  sandbox: SandboxContext,
  cycleDate: string,
  alpaca: AlpacaService,
  prisma: PrismaClient,
  defaultTimeStop = 10
): Promise<{ sandbox: SandboxContext; closes: CloseEvent[] }> {
  const open: (TradePlanRow & { cycle: { date: string } })[] = await prisma.tradePlan.findMany({
    where: { symbol, status: 'active', action: 'BUY' },
    include: { cycle: { select: { date: true } } },
  });

  let s = sandbox;
  const closes: CloseEvent[] = [];

  for (const plan of open) {
    if (plan.stop === null) continue;

    const horizon = plan.timeStopBars ?? defaultTimeStop;
    const bars = await alpaca.getBarsAfter(symbol, plan.cycle.date, horizon);
    if (bars.length === 0) continue;

    // Don't peek past the cycle date — only consider bars whose timestamp <= cycleDate end-of-day.
    const cycleEpoch = epochOf(`${cycleDate}T23:59:59Z`);
    const visibleBars = bars.filter((b) => epochOf(b.timestamp) <= cycleEpoch);
    if (visibleBars.length === 0) continue;

    const exit = detectExit(plan, visibleBars, defaultTimeStop);
    if (!exit) continue;

    const realizedPnl = (exit.exitPrice - plan.entry) * plan.shares;
    const rMultiple = plan.riskDollars > 0 ? realizedPnl / plan.riskDollars : 0;

    await prisma.tradePlan.update({
      where: { id: plan.id },
      data: {
        status: 'closed',
        closeReason: exit.closeReason,
        closedAt: new Date(exit.exitTimestamp),
        realizedPnl,
      },
    });

    s = applyCloseToSandbox(s, symbol, plan.shares, exit.exitPrice);

    closes.push({
      planId: plan.id,
      symbol,
      shares: plan.shares,
      entry: plan.entry,
      exitPrice: exit.exitPrice,
      exitTimestamp: exit.exitTimestamp,
      closeReason: exit.closeReason,
      realizedPnl,
      rMultiple,
    });
  }

  return { sandbox: s, closes };
}

/**
 * Discretionary CLOSE — head trader called CLOSE in this cycle. Closes the
 * active position for `symbol` at the supplied price (typically today's close).
 */
export async function discretionaryClose(
  symbol: string,
  sandbox: SandboxContext,
  exitPrice: number,
  cycleDate: string,
  prisma: PrismaClient
): Promise<{ sandbox: SandboxContext; close: CloseEvent | null }> {
  const plan = await prisma.tradePlan.findFirst({
    where: { symbol, status: 'active', action: 'BUY' },
    orderBy: { createdAt: 'desc' },
  });
  if (!plan) return { sandbox, close: null };

  const realizedPnl = (exitPrice - plan.entry) * plan.shares;
  const rMultiple = plan.riskDollars > 0 ? realizedPnl / plan.riskDollars : 0;

  await prisma.tradePlan.update({
    where: { id: plan.id },
    data: {
      status: 'closed',
      closeReason: 'discretionary',
      closedAt: new Date(`${cycleDate}T16:00:00Z`),
      realizedPnl,
    },
  });

  return {
    sandbox: applyCloseToSandbox(sandbox, symbol, plan.shares, exitPrice),
    close: {
      planId: plan.id,
      symbol,
      shares: plan.shares,
      entry: plan.entry,
      exitPrice,
      exitTimestamp: `${cycleDate}T16:00:00Z`,
      closeReason: 'discretionary',
      realizedPnl,
      rMultiple,
    },
  };
}

function epochOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}
