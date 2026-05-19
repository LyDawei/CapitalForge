import { prisma } from '../db';

/**
 * Calibration audit: does a stated confidence of N actually win N% of the time?
 *
 * For each closed trade, we look up the contributing specialist's confidence and
 * whether the trade was a "win" (realizedPnl > 0). Bucket by confidence and
 * compute observed win rate per bucket.
 *
 * Brier score = mean((confidence - outcome)^2) where outcome is {0,1}.
 *
 * Lower Brier = better calibration. Reliability curve compares each bucket's
 * stated avg-confidence to its observed win rate; perfectly calibrated agents
 * sit on the diagonal y=x.
 */
export async function computeCalibration(agentId: string, buckets: number) {
  // Pull specialist analyses for this agent whose cycle has a closed trade.
  const rows = await prisma.specialistAnalysis.findMany({
    where: {
      agentRun: { agentId },
      cycle: { tradePlan: { outcome: { isNot: null } } },
    },
    select: {
      confidence: true,
      bullishScore: true,
      cycle: {
        select: {
          tradePlan: { select: { outcome: { select: { realizedPnl: true, rMultiple: true } } } },
        },
      },
    },
  });

  if (rows.length === 0) {
    return { sampleSize: 0, brierScore: null, buckets: [] };
  }

  const points = rows
    .map((r) => {
      const pnl = r.cycle?.tradePlan?.outcome?.realizedPnl ?? null;
      if (pnl === null) return null;
      // Confidence in bullishness (direction) — only counts when the specialist
      // committed to a direction (|bullishScore| > 0.1) and confidence > 0.
      const directional = Math.abs(r.bullishScore) > 0.1;
      if (!directional) return null;
      const predictedUp = r.bullishScore > 0;
      const wentUp = pnl > 0;
      const correct = predictedUp === wentUp ? 1 : 0;
      return { confidence: r.confidence, correct };
    })
    .filter((x): x is { confidence: number; correct: number } => x !== null);

  if (points.length === 0) {
    return { sampleSize: 0, brierScore: null, buckets: [] };
  }

  const brierScore =
    points.reduce((acc, p) => acc + Math.pow(p.confidence - p.correct, 2), 0) / points.length;

  const bucketed = Array.from({ length: buckets }, (_, i) => {
    const lo = i / buckets;
    const hi = (i + 1) / buckets;
    const inBucket = points.filter((p) => p.confidence >= lo && p.confidence < hi);
    const observed =
      inBucket.length === 0 ? null : inBucket.reduce((a, b) => a + b.correct, 0) / inBucket.length;
    const meanConfidence =
      inBucket.length === 0
        ? (lo + hi) / 2
        : inBucket.reduce((a, b) => a + b.confidence, 0) / inBucket.length;
    return { bucketStart: lo, bucketEnd: hi, count: inBucket.length, meanConfidence, observedWinRate: observed };
  });

  return { sampleSize: points.length, brierScore, buckets: bucketed };
}
