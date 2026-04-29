import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPrismaClient } from '../prisma';

const EquityCurveQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/portfolio/state',
    {
      schema: {
        tags: ['portfolio'],
        summary: 'Current sandbox state (most recent SandboxState row)',
      },
    },
    async () => {
      const state = await prisma.sandboxState.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      return state ?? null;
    }
  );

  app.get(
    '/portfolio/equity-curve',
    {
      schema: {
        querystring: EquityCurveQuerySchema,
        tags: ['portfolio'],
        summary: 'Equity curve — one point per date (latest snapshot per date)',
      },
    },
    async (req) => {
      const { from, to } = req.query;
      const where: Record<string, unknown> = {};
      if (from || to) {
        const dateFilter: Record<string, string> = {};
        if (from) dateFilter.gte = from;
        if (to) dateFilter.lte = to;
        where.date = dateFilter;
      }
      const rows = await prisma.sandboxState.findMany({
        where,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      // Keep only the latest snapshot per date
      const byDate = new Map<string, (typeof rows)[number]>();
      for (const row of rows) byDate.set(row.date, row);
      return Array.from(byDate.values()).map((r) => ({
        date: r.date,
        currentEquity: r.currentEquity,
        peakEquity: r.peakEquity,
        cashBalance: r.cashBalance,
        positionQty: r.positionQty,
        positionSymbol: r.positionSymbol,
        drawdownPct: r.drawdownPct,
      }));
    }
  );

  app.get(
    '/portfolio/snapshots',
    {
      schema: {
        querystring: EquityCurveQuerySchema,
        tags: ['portfolio'],
        summary: 'All sandbox snapshots (raw, not deduped)',
      },
    },
    async (req) => {
      const { from, to } = req.query;
      const where: Record<string, unknown> = {};
      if (from || to) {
        const dateFilter: Record<string, string> = {};
        if (from) dateFilter.gte = from;
        if (to) dateFilter.lte = to;
        where.date = dateFilter;
      }
      return prisma.sandboxState.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
    }
  );
};
