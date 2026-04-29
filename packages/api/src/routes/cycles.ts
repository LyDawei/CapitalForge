import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPrismaClient } from '../prisma';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const CycleListQuerySchema = PaginationSchema.extend({
  from: z.string().optional(),
  to: z.string().optional(),
  symbol: z.string().optional(),
  status: z.enum(['pending', 'completed', 'failed']).optional(),
  engineVersion: z.enum(['v1', 'v2']).optional(),
});

const CycleParamsSchema = z.object({ id: z.string().uuid() });

export const cycleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/cycles',
    {
      schema: {
        querystring: CycleListQuerySchema,
        tags: ['cycles'],
        summary: 'Paginated list of daily cycles',
      },
    },
    async (req) => {
      const { page, pageSize, from, to, symbol, status, engineVersion } = req.query;
      const where: Record<string, unknown> = {};
      if (symbol) where.symbol = symbol;
      if (status) where.status = status;
      if (engineVersion) where.engineVersion = engineVersion;
      if (from || to) {
        const dateFilter: Record<string, string> = {};
        if (from) dateFilter.gte = from;
        if (to) dateFilter.lte = to;
        where.date = dateFilter;
      }

      const [data, total] = await Promise.all([
        prisma.dailyCycle.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            decision: true,
            trade: true,
            tradePlan: { select: { action: true, conviction: true, shares: true, status: true } },
            deliberation: { select: { finalAction: true, conviction: true, rounds: true } },
          },
        }),
        prisma.dailyCycle.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }
  );

  app.get(
    '/cycles/:id',
    {
      schema: {
        params: CycleParamsSchema,
        tags: ['cycles'],
        summary: 'Single cycle with all V1/V2 relations',
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const cycle = await prisma.dailyCycle.findUnique({
        where: { id },
        include: {
          evaluations: { orderBy: { createdAt: 'asc' } },
          decision: true,
          trade: true,
          specialistAnalyses: { orderBy: { createdAt: 'asc' } },
          deliberation: { include: { toolCalls: { orderBy: { round: 'asc' } } } },
          tradePlan: true,
        },
      });
      if (!cycle) {
        reply.code(404);
        return { error: { code: 'CYCLE_NOT_FOUND', message: `No cycle with id ${id}` } };
      }
      return cycle;
    }
  );

  app.get(
    '/symbols',
    {
      schema: {
        tags: ['symbols'],
        summary: 'Distinct symbols ever traded with cycle counts',
      },
    },
    async () => {
      const rows = await prisma.dailyCycle.groupBy({
        by: ['symbol'],
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { symbol: 'asc' },
      });
      return rows.map((r) => ({
        symbol: r.symbol,
        cycleCount: r._count._all,
        lastSeen: r._max.createdAt,
      }));
    }
  );

  app.get(
    '/symbols/summary',
    {
      schema: {
        tags: ['symbols'],
        summary: 'Rich per-symbol summary for the cycles overview cards',
      },
    },
    async () => {
      // 0. Latest sandbox snapshot — used to attach "your position" to the symbol the wallet currently holds.
      const sandbox = await prisma.sandboxState.findFirst({ orderBy: { createdAt: 'desc' } });

      // 1. Pull every cycle the engine has touched (small dataset for now).
      const cycles = await prisma.dailyCycle.findMany({
        orderBy: [{ symbol: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          symbol: true,
          date: true,
          status: true,
          createdAt: true,
          technicalData: true,
          decision: { select: { decision: true, weightedScore: true } },
          tradePlan: { select: { action: true, conviction: true, status: true, realizedPnl: true, riskDollars: true } },
          deliberation: { select: { finalAction: true, conviction: true } },
        },
      });

      const bySymbol = new Map<string, typeof cycles>();
      for (const c of cycles) {
        if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, []);
        bySymbol.get(c.symbol)!.push(c);
      }

      const summaries = Array.from(bySymbol.entries()).map(([symbol, list]) => {
        const latest = list[0];
        const closeOf = (c: (typeof list)[number]): number =>
          (c.technicalData as { close?: number } | null)?.close ?? 0;
        // Take recentCloses oldest → newest for a left-to-right sparkline
        const recentCloses = list.slice(0, 20).reverse().map(closeOf);

        const settled = list.filter(
          (c) => c.tradePlan?.status === 'closed' && c.tradePlan?.action === 'BUY' && c.tradePlan?.realizedPnl !== null
        );
        const wins = settled.filter((c) => (c.tradePlan?.realizedPnl ?? 0) > 0).length;
        const losses = settled.length - wins;
        const totalR = settled.reduce((sum, c) => {
          const r = (c.tradePlan?.riskDollars ?? 0) > 0 ? (c.tradePlan!.realizedPnl ?? 0) / c.tradePlan!.riskDollars : 0;
          return sum + r;
        }, 0);

        const action =
          latest.tradePlan?.action ??
          latest.deliberation?.finalAction ??
          latest.decision?.decision ??
          null;
        const conviction =
          latest.tradePlan?.conviction ?? latest.deliberation?.conviction ?? null;

        // Surface "your position" only on the symbol the sandbox currently holds.
        const myPosition =
          sandbox && sandbox.positionSymbol === symbol && sandbox.positionQty > 0
            ? {
                shares: sandbox.positionQty,
                avgPrice: sandbox.positionAvgPrice,
                marketValue: sandbox.positionQty * closeOf(latest),
                unrealizedPnl:
                  sandbox.positionAvgPrice !== null
                    ? sandbox.positionQty * (closeOf(latest) - sandbox.positionAvgPrice)
                    : null,
              }
            : null;

        return {
          symbol,
          cycleCount: list.length,
          lastSeen: latest.createdAt,
          latestCycle: {
            id: latest.id,
            date: latest.date,
            action,
            conviction,
            status: latest.status,
            close: closeOf(latest),
          },
          recentCloses,
          outcomes: {
            settled: settled.length,
            wins,
            losses,
            winRate: settled.length > 0 ? wins / settled.length : null,
            totalR,
          },
          myPosition,
        };
      });

      summaries.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
      return summaries;
    }
  );

  app.get(
    '/symbols/:symbol/cycles',
    {
      schema: {
        params: z.object({ symbol: z.string().min(1) }),
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        }),
        tags: ['symbols'],
        summary: 'Paginated cycles for one symbol (chronological)',
      },
    },
    async (req) => {
      const { symbol } = req.params;
      const { page, pageSize } = req.query;
      const [data, total] = await Promise.all([
        prisma.dailyCycle.findMany({
          where: { symbol },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            decision: true,
            trade: true,
            tradePlan: true,
            deliberation: { select: { finalAction: true, conviction: true, rounds: true } },
          },
        }),
        prisma.dailyCycle.count({ where: { symbol } }),
      ]);
      return {
        symbol,
        data,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    }
  );
};
