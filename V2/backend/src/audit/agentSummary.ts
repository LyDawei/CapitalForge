import { prisma } from '../db';

/**
 * Top-level summary card for an agent: sample counts, latency, cost, schema
 * failure rate. Cheap to compute from AgentRun aggregates.
 */
export async function computeAgentSummary(
  agentId: string,
  window: '7d' | '30d' | '90d' | 'all',
) {
  const windowStart = windowToDate(window);
  const where = {
    agentId,
    ...(windowStart ? { createdAt: { gte: windowStart } } : {}),
  };

  const [total, valid, agg] = await Promise.all([
    prisma.agentRun.count({ where }),
    prisma.agentRun.count({ where: { ...where, schemaValid: true } }),
    prisma.agentRun.aggregate({
      where,
      _avg: { latencyMs: true, costUsd: true, tokensIn: true, tokensOut: true },
      _sum: { costUsd: true, tokensIn: true, tokensOut: true },
    }),
  ]);

  const schemaFailRate = total === 0 ? 0 : (total - valid) / total;

  return {
    window,
    sampleSize: total,
    schemaValid: valid,
    schemaFailRate,
    avgLatencyMs: agg._avg.latencyMs ?? 0,
    avgCostUsd: agg._avg.costUsd ?? 0,
    totalCostUsd: agg._sum.costUsd ?? 0,
    totalTokensIn: agg._sum.tokensIn ?? 0,
    totalTokensOut: agg._sum.tokensOut ?? 0,
  };
}

function windowToDate(window: '7d' | '30d' | '90d' | 'all'): Date | null {
  if (window === 'all') return null;
  const days = parseInt(window.replace('d', ''), 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
