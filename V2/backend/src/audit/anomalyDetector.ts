import { prisma } from '../db';
import { computePredictionScores } from './predictionScore';

/**
 * Scans current prediction scores + recent runs and writes Anomaly rows for
 * conditions a human should review. Idempotent on (kind, agentId, day) — won't
 * spam the same anomaly twice in 24h.
 */
export async function runAnomalyDetector(): Promise<{ created: number }> {
  let created = 0;

  // 1. Agents flagged by predictionScore.needsReview
  const scores = await computePredictionScores();
  for (const s of scores) {
    if (!s.needsReview) continue;
    const kind = s.hitRate !== null && s.hitRate < 0.45 ? 'hit_rate_drop' : 'output_drift';
    const exists = await prisma.anomaly.findFirst({
      where: {
        kind: kind as any,
        agentId: s.agentId,
        createdAt: { gte: oneDayAgo() },
      },
    });
    if (exists) continue;
    await prisma.anomaly.create({
      data: {
        kind: kind as any,
        severity: s.hitRate !== null && s.hitRate < 0.4 ? 'error' : 'warn',
        agentId: s.agentId,
        body: `${s.displayName}: ${s.reviewReasons.join('; ')}`,
        detail: s as any,
      },
    });
    created++;
  }

  // 2. Latency spikes — any run > 3x the agent's p95 in the last 30 days
  const recentRuns = await prisma.agentRun.findMany({
    where: { createdAt: { gte: oneDayAgo() } },
    select: { id: true, agentId: true, latencyMs: true, cycleId: true, createdAt: true },
  });
  for (const r of recentRuns) {
    const baseline = await prisma.agentRun.aggregate({
      where: { agentId: r.agentId, createdAt: { gte: thirtyDaysAgo(), lt: oneDayAgo() } },
      _avg: { latencyMs: true },
    });
    const avg = baseline._avg.latencyMs ?? 0;
    if (avg > 0 && r.latencyMs > avg * 3 && r.latencyMs > 3000) {
      const exists = await prisma.anomaly.findFirst({
        where: {
          kind: 'latency_spike',
          agentId: r.agentId,
          createdAt: { gte: new Date(r.createdAt.getTime() - 60_000) },
        },
      });
      if (exists) continue;
      await prisma.anomaly.create({
        data: {
          kind: 'latency_spike',
          severity: 'warn',
          agentId: r.agentId,
          cycleId: r.cycleId,
          body: `Run latency ${r.latencyMs}ms vs 30d avg ${Math.round(avg)}ms`,
          detail: { runId: r.id, latencyMs: r.latencyMs, baselineMs: avg } as any,
        },
      });
      created++;
    }
  }

  return { created };
}

function oneDayAgo() { return new Date(Date.now() - 24 * 60 * 60 * 1000); }
function thirtyDaysAgo() { return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); }
