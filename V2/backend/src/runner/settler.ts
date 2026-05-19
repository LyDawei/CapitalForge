import { prisma } from '../db';
import { getAlpacaService } from '../services/alpaca';

/**
 * Settles proposed TradePlans that haven't been settled yet. Walks each plan
 * forward through bars after the entry date. Detects stop-hit, target-hit, or
 * time-stop and writes a TradeOutcome row.
 *
 * This is the counterfactual settler — same idea as V1's settlePlans.ts but
 * writing to the V2 schema.
 */
export async function settleProposedPlans(): Promise<number> {
  const plans = await prisma.tradePlan.findMany({
    where: { status: 'proposed', action: { in: ['BUY', 'SELL'] } },
    include: { cycle: { select: { date: true } } },
  });

  if (plans.length === 0) return 0;

  const alpaca = getAlpacaService();
  let settled = 0;

  for (const plan of plans) {
    const bars = await alpaca.getBarsAfter(plan.symbol, plan.cycle.date, plan.timeStopBars ?? 10);
    if (bars.length === 0) continue;

    let closeReason: string | null = null;
    let exitPrice = 0;
    let heldBars = 0;
    let mfe = 0;
    let mae = 0;

    const isLong = plan.action === 'BUY';

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      heldBars = i + 1;

      // Track MFE / MAE
      const excursion = isLong ? bar.high - plan.entry : plan.entry - bar.low;
      const drawdown = isLong ? plan.entry - bar.low : bar.high - plan.entry;
      if (excursion > mfe) mfe = excursion;
      if (drawdown > mae) mae = drawdown;

      // Stop check
      if (plan.stop !== null) {
        if (isLong && bar.low <= plan.stop) {
          closeReason = 'stop_hit';
          exitPrice = plan.stop;
          break;
        }
        if (!isLong && bar.high >= plan.stop) {
          closeReason = 'stop_hit';
          exitPrice = plan.stop;
          break;
        }
      }

      // Target1 check
      if (plan.target1 !== null) {
        if (isLong && bar.high >= plan.target1) {
          closeReason = 'target1_hit';
          exitPrice = plan.target1;
          break;
        }
        if (!isLong && bar.low <= plan.target1) {
          closeReason = 'target1_hit';
          exitPrice = plan.target1;
          break;
        }
      }

      // Target2 check
      if (plan.target2 !== null) {
        if (isLong && bar.high >= plan.target2) {
          closeReason = 'target_hit';
          exitPrice = plan.target2;
          break;
        }
        if (!isLong && bar.low <= plan.target2) {
          closeReason = 'target_hit';
          exitPrice = plan.target2;
          break;
        }
      }
    }

    // Time stop — if no target or stop was hit
    if (!closeReason) {
      closeReason = 'time_stop';
      exitPrice = bars[bars.length - 1]!.close;
      heldBars = bars.length;
    }

    const realizedPnl = isLong
      ? (exitPrice - plan.entry) * plan.shares
      : (plan.entry - exitPrice) * plan.shares;

    const rMultiple =
      plan.stop !== null && plan.stop !== plan.entry
        ? (exitPrice - plan.entry) / Math.abs(plan.entry - plan.stop) * (isLong ? 1 : -1)
        : null;

    await prisma.tradePlan.update({
      where: { id: plan.id },
      data: {
        status: 'closed',
        closeReason: closeReason as any,
        closedAt: new Date(),
        realizedPnl,
        heldBars,
      },
    });

    await prisma.tradeOutcome.create({
      data: {
        tradePlanId: plan.id,
        closeReason: closeReason as any,
        realizedPnl,
        rMultiple,
        mfe: +mfe.toFixed(2),
        mae: +mae.toFixed(2),
        heldBars,
      },
    });

    settled++;
  }

  return settled;
}
