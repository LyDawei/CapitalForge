import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AGENT_REGISTRY } from '@capitalforge/shared';
import { getPrismaClient } from '../prisma';
import { Prisma } from '@prisma/client';

const AgentParamsSchema = z.object({ name: z.string().min(1) });

interface ScoreBucket {
  bucket: 'bullish' | 'bearish' | 'neutral';
  count: number;
  /** Distribution of head-trader actions when this specialist scored in this bucket. */
  actions: Record<string, number>;
}

interface AgentPerformance {
  agentName: string;
  engineVersion: 'v1' | 'v2';
  totalRuns: number;
  hasOutcomes: boolean;
  /** Outcome attribution — only populated for V2 specialists once trade plans have settled. */
  outcomes: {
    settledTradePlans: number;
    winningTradePlans: number;
    losingTradePlans: number;
    avgScoreInWinners: number | null;
    avgScoreInLosers: number | null;
    avgConfidenceInWinners: number | null;
    avgConfidenceInLosers: number | null;
  };
  /** Conviction → action distribution (head trader specific). */
  scoreBuckets: ScoreBucket[];
  /** For BUY plans, the realized R-multiple distribution by score bucket. */
  rMultipleByBucket: Array<{ bucket: 'bullish' | 'bearish' | 'neutral'; avgR: number; sample: number }>;
}

function bucketFor(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score >= 0.4) return 'bullish';
  if (score <= -0.4) return 'bearish';
  return 'neutral';
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function resolveAgent(name: string) {
  return AGENT_REGISTRY.find((a) => a.name === name || `${a.name}-${a.engineVersion}` === name);
}

export const performanceRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/agents/:name/performance',
    {
      schema: {
        params: AgentParamsSchema,
        tags: ['agents'],
        summary: 'Performance metrics for an agent (run counts, win rate, score-vs-outcome stats)',
      },
    },
    async (req, reply) => {
      const agent = resolveAgent(req.params.name);
      if (!agent) {
        reply.code(404);
        return { error: { code: 'AGENT_NOT_FOUND', message: `No agent ${req.params.name}` } };
      }

      // Specialist (V2): score lives in SpecialistAnalysis. Head trader: in Deliberation.
      // V1 agents: AgentEvaluation.
      if (agent.kind === 'specialist') {
        return computeSpecialistPerformance(prisma, agent.name);
      }
      if (agent.kind === 'head_trader') {
        return computeHeadTraderPerformance(prisma);
      }
      return computeV1AgentPerformance(prisma, agent.name);
    }
  );

  // Convenience: portfolio-level outcome roll-up.
  app.get(
    '/portfolio/outcomes',
    {
      schema: {
        tags: ['portfolio'],
        summary: 'Aggregate trade-plan outcomes (wins, losses, total R)',
      },
    },
    async () => {
      const closed = await prisma.tradePlan.findMany({
        where: { status: 'closed', action: 'BUY', realizedPnl: { not: null } },
        select: { id: true, realizedPnl: true, riskDollars: true, closeReason: true },
      });
      const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0);
      const losses = closed.filter((p) => (p.realizedPnl ?? 0) <= 0);
      const totalR = closed.reduce((sum, p) => {
        const r = p.riskDollars > 0 ? (p.realizedPnl ?? 0) / p.riskDollars : 0;
        return sum + r;
      }, 0);
      const totalPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);
      const closeReasons: Record<string, number> = {};
      for (const p of closed) {
        if (p.closeReason) closeReasons[p.closeReason] = (closeReasons[p.closeReason] ?? 0) + 1;
      }
      return {
        settled: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length === 0 ? null : wins.length / closed.length,
        avgRPerTrade: closed.length === 0 ? null : totalR / closed.length,
        totalR,
        totalPnl,
        closeReasons,
      };
    }
  );
};

async function computeSpecialistPerformance(
  prisma: ReturnType<typeof getPrismaClient>,
  specialistName: string
): Promise<AgentPerformance> {
  const analyses = await prisma.specialistAnalysis.findMany({
    where: { specialistName },
    include: {
      cycle: {
        include: {
          tradePlan: { select: { action: true, realizedPnl: true, riskDollars: true, status: true } },
        },
      },
    },
  });

  const buckets: Record<'bullish' | 'bearish' | 'neutral', ScoreBucket> = {
    bullish: { bucket: 'bullish', count: 0, actions: {} },
    bearish: { bucket: 'bearish', count: 0, actions: {} },
    neutral: { bucket: 'neutral', count: 0, actions: {} },
  };

  const winnerScores: number[] = [];
  const winnerConfs: number[] = [];
  const loserScores: number[] = [];
  const loserConfs: number[] = [];
  const rByBucket: Record<'bullish' | 'bearish' | 'neutral', number[]> = {
    bullish: [],
    bearish: [],
    neutral: [],
  };
  let settled = 0;
  let wins = 0;
  let losses = 0;

  for (const a of analyses) {
    const b = bucketFor(a.bullishScore);
    buckets[b].count++;
    const action = a.cycle.tradePlan?.action ?? 'NONE';
    buckets[b].actions[action] = (buckets[b].actions[action] ?? 0) + 1;

    const plan = a.cycle.tradePlan;
    if (plan && plan.status === 'closed' && plan.action === 'BUY' && plan.realizedPnl !== null) {
      settled++;
      const isWin = plan.realizedPnl > 0;
      if (isWin) {
        wins++;
        winnerScores.push(a.bullishScore);
        winnerConfs.push(a.confidence);
      } else {
        losses++;
        loserScores.push(a.bullishScore);
        loserConfs.push(a.confidence);
      }
      const r = plan.riskDollars > 0 ? plan.realizedPnl / plan.riskDollars : 0;
      rByBucket[b].push(r);
    }
  }

  return {
    agentName: specialistName,
    engineVersion: 'v2',
    totalRuns: analyses.length,
    hasOutcomes: settled > 0,
    outcomes: {
      settledTradePlans: settled,
      winningTradePlans: wins,
      losingTradePlans: losses,
      avgScoreInWinners: avg(winnerScores),
      avgScoreInLosers: avg(loserScores),
      avgConfidenceInWinners: avg(winnerConfs),
      avgConfidenceInLosers: avg(loserConfs),
    },
    scoreBuckets: Object.values(buckets),
    rMultipleByBucket: (Object.keys(rByBucket) as Array<'bullish' | 'bearish' | 'neutral'>).map(
      (key) => ({
        bucket: key,
        avgR: avg(rByBucket[key]) ?? 0,
        sample: rByBucket[key].length,
      })
    ),
  };
}

async function computeHeadTraderPerformance(
  prisma: ReturnType<typeof getPrismaClient>
): Promise<AgentPerformance> {
  const deliberations = await prisma.deliberation.findMany({
    include: {
      cycle: {
        include: {
          tradePlan: { select: { action: true, realizedPnl: true, riskDollars: true, status: true } },
        },
      },
    },
  });

  // For the head trader, the "score" is conviction. Bucket by conviction band.
  const buckets: Record<'bullish' | 'bearish' | 'neutral', ScoreBucket> = {
    bullish: { bucket: 'bullish', count: 0, actions: {} }, // high conviction
    neutral: { bucket: 'neutral', count: 0, actions: {} }, // mid conviction
    bearish: { bucket: 'bearish', count: 0, actions: {} }, // low conviction
  };
  const rByBucket: Record<'bullish' | 'bearish' | 'neutral', number[]> = {
    bullish: [],
    neutral: [],
    bearish: [],
  };
  const winnerScores: number[] = [];
  const winnerConfs: number[] = [];
  const loserScores: number[] = [];
  const loserConfs: number[] = [];
  let settled = 0;
  let wins = 0;
  let losses = 0;

  for (const d of deliberations) {
    const b: 'bullish' | 'bearish' | 'neutral' =
      d.conviction >= 0.7 ? 'bullish' : d.conviction >= 0.5 ? 'neutral' : 'bearish';
    buckets[b].count++;
    buckets[b].actions[d.finalAction] = (buckets[b].actions[d.finalAction] ?? 0) + 1;

    const plan = d.cycle.tradePlan;
    if (plan && plan.status === 'closed' && plan.action === 'BUY' && plan.realizedPnl !== null) {
      settled++;
      const isWin = plan.realizedPnl > 0;
      if (isWin) {
        wins++;
        winnerScores.push(d.conviction);
        winnerConfs.push(d.conviction);
      } else {
        losses++;
        loserScores.push(d.conviction);
        loserConfs.push(d.conviction);
      }
      const r = plan.riskDollars > 0 ? plan.realizedPnl / plan.riskDollars : 0;
      rByBucket[b].push(r);
    }
  }

  return {
    agentName: 'headTrader',
    engineVersion: 'v2',
    totalRuns: deliberations.length,
    hasOutcomes: settled > 0,
    outcomes: {
      settledTradePlans: settled,
      winningTradePlans: wins,
      losingTradePlans: losses,
      avgScoreInWinners: avg(winnerScores),
      avgScoreInLosers: avg(loserScores),
      avgConfidenceInWinners: avg(winnerConfs),
      avgConfidenceInLosers: avg(loserConfs),
    },
    scoreBuckets: Object.values(buckets),
    rMultipleByBucket: (Object.keys(rByBucket) as Array<'bullish' | 'bearish' | 'neutral'>).map(
      (key) => ({
        bucket: key,
        avgR: avg(rByBucket[key]) ?? 0,
        sample: rByBucket[key].length,
      })
    ),
  };
}

async function computeV1AgentPerformance(
  prisma: ReturnType<typeof getPrismaClient>,
  agentName: string
): Promise<AgentPerformance> {
  const evals = await prisma.agentEvaluation.findMany({
    where: { agentName },
    include: {
      cycle: { include: { trade: { select: { side: true, status: true } } } },
    },
  });
  const buckets: Record<'bullish' | 'bearish' | 'neutral', ScoreBucket> = {
    bullish: { bucket: 'bullish', count: 0, actions: {} },
    bearish: { bucket: 'bearish', count: 0, actions: {} },
    neutral: { bucket: 'neutral', count: 0, actions: {} },
  };
  for (const e of evals) {
    const b = bucketFor(e.bullishScore);
    buckets[b].count++;
    const action = e.cycle.trade?.side ? e.cycle.trade.side.toUpperCase() : 'NONE';
    buckets[b].actions[action] = (buckets[b].actions[action] ?? 0) + 1;
  }
  return {
    agentName,
    engineVersion: 'v1',
    totalRuns: evals.length,
    hasOutcomes: false, // V1 has no realizedPnl tracking by design
    outcomes: {
      settledTradePlans: 0,
      winningTradePlans: 0,
      losingTradePlans: 0,
      avgScoreInWinners: null,
      avgScoreInLosers: null,
      avgConfidenceInWinners: null,
      avgConfidenceInLosers: null,
    },
    scoreBuckets: Object.values(buckets),
    rMultipleByBucket: [],
  };
}

// Suppress unused-import lint warning — Prisma type may surface via tsserver
void Prisma;
