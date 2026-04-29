import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AGENT_REGISTRY } from '@capitalforge/shared';
import { getPrismaClient } from '../prisma';

const AgentParamsSchema = z.object({ name: z.string().min(1) });

const PromptListQuerySchema = z.object({
  agent: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const PromptParamsSchema = z.object({ id: z.string().uuid() });

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/agents',
    {
      schema: {
        tags: ['agents'],
        summary: 'Static metadata for every LLM-driven agent (V1 + V2 + head trader)',
      },
    },
    async () => {
      // For each registry entry, attach DB facts: number of times it has run, latest cycle.
      const results = await Promise.all(
        AGENT_REGISTRY.map(async (agent) => {
          const [specialistRuns, evaluationRuns, deliberationRuns, promptCount] =
            await Promise.all([
              prisma.specialistAnalysis.count({ where: { specialistName: agent.name } }),
              prisma.agentEvaluation.count({ where: { agentName: agent.name } }),
              agent.kind === 'head_trader'
                ? prisma.deliberation.count()
                : Promise.resolve(0),
              prisma.promptVersion.count({ where: { agentName: agent.name } }),
            ]);
          const totalRuns =
            agent.kind === 'specialist'
              ? specialistRuns
              : agent.kind === 'head_trader'
                ? deliberationRuns
                : evaluationRuns;
          return {
            ...agent,
            stats: { totalRuns, persistedPromptVersions: promptCount },
          };
        })
      );
      return results;
    }
  );

  app.get(
    '/agents/summary',
    {
      schema: {
        tags: ['agents'],
        summary: 'Per-agent summary card data (recent scores, win rate, last activity)',
      },
    },
    async () => {
      const SAMPLE = 20;
      const enriched = await Promise.all(
        AGENT_REGISTRY.map(async (agent) => {
          // Pick the score-bearing rows for this agent kind
          let recentScores: number[] = [];
          let lastSeen: Date | null = null;
          let totalRuns = 0;
          let cycleIds: string[] = [];

          let lastCycleId: string | null = null;
          if (agent.kind === 'specialist') {
            const rows = await prisma.specialistAnalysis.findMany({
              where: { specialistName: agent.name },
              orderBy: { createdAt: 'desc' },
              take: SAMPLE,
              select: { bullishScore: true, createdAt: true, cycleId: true },
            });
            totalRuns = await prisma.specialistAnalysis.count({
              where: { specialistName: agent.name },
            });
            recentScores = rows.slice().reverse().map((r) => r.bullishScore);
            lastSeen = rows[0]?.createdAt ?? null;
            lastCycleId = rows[0]?.cycleId ?? null;
            cycleIds = rows.map((r) => r.cycleId);
          } else if (agent.kind === 'head_trader') {
            const rows = await prisma.deliberation.findMany({
              orderBy: { createdAt: 'desc' },
              take: SAMPLE,
              select: { conviction: true, createdAt: true, cycleId: true },
            });
            totalRuns = await prisma.deliberation.count();
            recentScores = rows.slice().reverse().map((r) => r.conviction);
            lastSeen = rows[0]?.createdAt ?? null;
            lastCycleId = rows[0]?.cycleId ?? null;
            cycleIds = rows.map((r) => r.cycleId);
          } else {
            const rows = await prisma.agentEvaluation.findMany({
              where: { agentName: agent.name },
              orderBy: { createdAt: 'desc' },
              take: SAMPLE,
              select: { bullishScore: true, createdAt: true, cycleId: true },
            });
            totalRuns = await prisma.agentEvaluation.count({
              where: { agentName: agent.name },
            });
            recentScores = rows.slice().reverse().map((r) => r.bullishScore);
            lastSeen = rows[0]?.createdAt ?? null;
            lastCycleId = rows[0]?.cycleId ?? null;
            cycleIds = rows.map((r) => r.cycleId);
          }

          // Outcome roll-up — only meaningful for V2 (V1 has no realizedPnl tracking).
          let outcomes = {
            settled: 0,
            wins: 0,
            losses: 0,
            winRate: null as number | null,
            totalR: 0,
          };
          if (agent.engineVersion === 'v2' && cycleIds.length > 0) {
            // Look at ALL cycles this agent has touched, not just the recent sample,
            // for a more stable win-rate signal.
            const allRows =
              agent.kind === 'specialist'
                ? await prisma.specialistAnalysis.findMany({
                    where: { specialistName: agent.name },
                    select: { cycleId: true },
                  })
                : agent.kind === 'head_trader'
                  ? await prisma.deliberation.findMany({ select: { cycleId: true } })
                  : [];
            const allCycleIds = Array.from(new Set(allRows.map((r) => r.cycleId)));
            if (allCycleIds.length > 0) {
              const settled = await prisma.tradePlan.findMany({
                where: {
                  cycleId: { in: allCycleIds },
                  status: 'closed',
                  action: 'BUY',
                  realizedPnl: { not: null },
                },
                select: { realizedPnl: true, riskDollars: true },
              });
              const wins = settled.filter((p) => (p.realizedPnl ?? 0) > 0).length;
              const totalR = settled.reduce((sum, p) => {
                const r = p.riskDollars > 0 ? (p.realizedPnl ?? 0) / p.riskDollars : 0;
                return sum + r;
              }, 0);
              outcomes = {
                settled: settled.length,
                wins,
                losses: settled.length - wins,
                winRate: settled.length > 0 ? wins / settled.length : null,
                totalR,
              };
            }
          }

          return {
            ...agent,
            stats: { totalRuns },
            recentScores,
            lastSeen,
            lastCycleId,
            outcomes,
          };
        })
      );
      return enriched;
    }
  );

  app.get(
    '/agents/:name',
    {
      schema: {
        params: AgentParamsSchema,
        tags: ['agents'],
        summary: 'Single agent metadata + persisted prompt versions',
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const agent = AGENT_REGISTRY.find(
        (a) =>
          a.name === name ||
          // Handle V1 vs V2 collisions (e.g. both have momentum/meanReversion/newsEvents)
          `${a.name}-${a.engineVersion}` === name
      );
      if (!agent) {
        reply.code(404);
        return { error: { code: 'AGENT_NOT_FOUND', message: `No agent named ${name}` } };
      }
      const promptVersions = await prisma.promptVersion.findMany({
        where: { agentName: agent.name },
        orderBy: { createdAt: 'desc' },
      });
      return { agent, promptVersions };
    }
  );

  app.get(
    '/prompts',
    {
      schema: {
        querystring: PromptListQuerySchema,
        tags: ['prompts'],
        summary: 'List PromptVersion rows (filterable by agent)',
      },
    },
    async (req) => {
      const { agent, limit } = req.query;
      return prisma.promptVersion.findMany({
        where: agent ? { agentName: agent } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
  );

  app.get(
    '/prompts/:id',
    {
      schema: {
        params: PromptParamsSchema,
        tags: ['prompts'],
        summary: 'Single PromptVersion (full template text)',
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const prompt = await prisma.promptVersion.findUnique({ where: { id } });
      if (!prompt) {
        reply.code(404);
        return { error: { code: 'PROMPT_NOT_FOUND', message: `No prompt with id ${id}` } };
      }
      return prompt;
    }
  );
};
