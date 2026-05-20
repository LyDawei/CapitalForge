import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerFeedRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /api/feeds — paginated FeedFetch list with consumption + decision counts.
  // -----------------------------------------------------------------------
  app.get(
    '/',
    {
      schema: {
        tags: ['feeds'],
        querystring: z.object({
          source: z.string().optional(),
          symbol: z.string().optional(),
          errored: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { source, symbol, errored, limit, offset } = req.query as {
        source?: string;
        symbol?: string;
        errored?: boolean;
        limit: number;
        offset: number;
      };
      const where = {
        ...(source ? { source } : {}),
        ...(symbol ? { symbol } : {}),
        ...(errored !== undefined ? { errored } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.feedFetch.findMany({
          where,
          orderBy: { fetchedAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            source: true,
            symbol: true,
            url: true,
            fetchedAt: true,
            latencyMs: true,
            costUsd: true,
            errored: true,
            errorMessage: true,
            _count: { select: { consumptions: true } },
          },
        }),
        prisma.feedFetch.count({ where }),
      ]);
      return { fetches: rows, total, limit, offset };
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/feeds/:id — detail. Returns payload + consumptions joined to
  // their AgentRun (agent name, parsed output, runKind) so the user can see
  // "this article was consumed by these agents and produced these decisions."
  // -----------------------------------------------------------------------
  app.get(
    '/:id',
    {
      schema: {
        tags: ['feeds'],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await prisma.feedFetch.findUnique({
        where: { id },
        include: {
          consumptions: {
            include: {
              agentRun: {
                select: {
                  id: true,
                  runKind: true,
                  schemaValid: true,
                  parsedOutput: true,
                  cycleId: true,
                  agent: { select: { name: true, displayName: true } },
                },
              },
            },
          },
        },
      });
      if (!row) return reply.notFound();
      return row;
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/feeds/sources — distinct source list with counts. Drives the UI
  // filter dropdown without forcing the client to do its own aggregation.
  // -----------------------------------------------------------------------
  app.get('/sources/summary', { schema: { tags: ['feeds'] } }, async () => {
    const rows = await prisma.feedFetch.groupBy({
      by: ['source'],
      _count: { _all: true },
      _sum: { latencyMs: true, costUsd: true },
      orderBy: { _count: { source: 'desc' } },
    });
    return rows.map((r) => ({
      source: r.source,
      totalFetches: r._count._all,
      totalLatencyMs: r._sum.latencyMs ?? 0,
      totalCostUsd: r._sum.costUsd ?? 0,
    }));
  });
}
