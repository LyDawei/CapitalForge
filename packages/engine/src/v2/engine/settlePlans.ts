import { PrismaClient } from '@prisma/client';
import { AlpacaService } from '../../services/alpaca';

export interface SettleResult {
  scanned: number;
  settled: number;
  skipped: number;
  failures: Array<{ tradePlanId: string; reason: string }>;
}

const DEFAULT_TIME_STOP_BARS = 10;

/**
 * Walk every TradePlan with status='proposed' and action='BUY' forward through subsequent
 * daily bars, deterministically detecting:
 *   - target1 hit (intra-bar high >= target1) → win
 *   - stop hit (intra-bar low <= stop)        → loss
 *   - time stop reached                        → close at the time-stop bar's close
 *
 * Updates the row in place: status='closed', closeReason, realizedPnl, closedAt.
 *
 * NOT a real-money executor — this is a counterfactual settler used to attribute outcomes
 * to specialist scores until the M5 lifecycle replaces it with live execution.
 *
 * If both stop and target are hit on the same bar, conservatively assume stop hit first
 * (path-dependent, worst-case-for-trader). This bias is documented and reproducible.
 */
export async function settleProposedPlans(
  prisma: PrismaClient,
  alpaca: AlpacaService,
  options: { minDaysOld?: number; maxToSettle?: number } = {}
): Promise<SettleResult> {
  const { minDaysOld = 1, maxToSettle = 200 } = options;
  const minCutoff = new Date();
  minCutoff.setDate(minCutoff.getDate() - minDaysOld);

  const candidates = await prisma.tradePlan.findMany({
    where: {
      status: 'proposed',
      action: 'BUY',
      stop: { not: null },
      createdAt: { lte: minCutoff },
    },
    include: { cycle: { select: { date: true } } },
    take: maxToSettle,
    orderBy: { createdAt: 'asc' },
  });

  const result: SettleResult = { scanned: candidates.length, settled: 0, skipped: 0, failures: [] };

  for (const plan of candidates) {
    try {
      if (plan.stop === null || plan.stop >= plan.entry) {
        result.skipped++;
        continue;
      }
      const lookback = plan.timeStopBars ?? DEFAULT_TIME_STOP_BARS;
      const bars = await alpaca.getBarsAfter(plan.symbol, plan.cycle.date, lookback);
      if (bars.length === 0) {
        result.skipped++;
        continue;
      }

      let exitPrice: number | null = null;
      let closeReason: 'stop_hit' | 'target_hit' | 'time_stop' | null = null;
      let exitTimestamp: string | null = null;

      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const stopHit = bar.low <= plan.stop;
        const targetHit = plan.target1 !== null && bar.high >= plan.target1;
        if (stopHit) {
          exitPrice = plan.stop;
          closeReason = 'stop_hit';
          exitTimestamp = bar.timestamp;
          break;
        }
        if (targetHit && plan.target1 !== null) {
          exitPrice = plan.target1;
          closeReason = 'target_hit';
          exitTimestamp = bar.timestamp;
          break;
        }
      }

      if (exitPrice === null) {
        // Time stop: close at the last bar's close
        const lastBar = bars[bars.length - 1];
        exitPrice = lastBar.close;
        closeReason = 'time_stop';
        exitTimestamp = lastBar.timestamp;
      }

      const realizedPnl = (exitPrice - plan.entry) * plan.shares;

      await prisma.tradePlan.update({
        where: { id: plan.id },
        data: {
          status: 'closed',
          closeReason,
          closedAt: exitTimestamp ? new Date(exitTimestamp) : new Date(),
          realizedPnl,
        },
      });
      result.settled++;
    } catch (err) {
      result.failures.push({
        tradePlanId: plan.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
