import { prisma } from '../db';

/**
 * Drift audit: rolling hit rate per prompt-version over time.
 *
 * Catches silent decay: a prompt that was great in March may be mediocre in May
 * because the regime shifted, or because subtle prompt changes had unintended
 * consequences. Plot the rolling N-day hit rate per (agent, promptVersion).
 */
export async function computeDrift(agentId: string, rollingDays: number) {
  const runs = await prisma.agentRun.findMany({
    where: {
      agentId,
      cycle: { tradePlan: { outcome: { isNot: null } } },
    },
    select: {
      createdAt: true,
      promptVersionId: true,
      promptVersion: { select: { version: true } },
      cycle: {
        select: {
          tradePlan: { select: { outcome: { select: { realizedPnl: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (runs.length === 0) return { rollingDays, series: [] };

  // Group by day + promptVersion, then compute rolling hit rate.
  type DayKey = string; // YYYY-MM-DD
  const byVersion = new Map<string, Map<DayKey, { wins: number; total: number; version: string }>>();
  for (const r of runs) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const pnl = r.cycle?.tradePlan?.outcome?.realizedPnl ?? null;
    if (pnl === null) continue;
    const map = byVersion.get(r.promptVersionId) ?? new Map();
    const cell = map.get(day) ?? { wins: 0, total: 0, version: r.promptVersion.version };
    cell.total += 1;
    if (pnl > 0) cell.wins += 1;
    map.set(day, cell);
    byVersion.set(r.promptVersionId, map);
  }

  const series: Array<{
    promptVersionId: string;
    version: string;
    points: Array<{ date: string; hitRate: number; sampleSize: number }>;
  }> = [];

  for (const [pvId, dayMap] of byVersion) {
    const days = Array.from(dayMap.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
    const points: Array<{ date: string; hitRate: number; sampleSize: number }> = [];
    for (let i = 0; i < days.length; i++) {
      // Roll over the prior `rollingDays` worth of entries.
      const windowEnd = days[i]![0];
      const windowEndDate = new Date(windowEnd);
      const windowStart = new Date(windowEndDate);
      windowStart.setDate(windowEndDate.getDate() - rollingDays);
      const windowStartStr = windowStart.toISOString().slice(0, 10);
      const inWindow = days.filter(([d]) => d >= windowStartStr && d <= windowEnd);
      const wins = inWindow.reduce((a, [, c]) => a + c.wins, 0);
      const total = inWindow.reduce((a, [, c]) => a + c.total, 0);
      if (total === 0) continue;
      points.push({ date: windowEnd, hitRate: wins / total, sampleSize: total });
    }
    series.push({ promptVersionId: pvId, version: days[0]![1].version, points });
  }

  return { rollingDays, series };
}
