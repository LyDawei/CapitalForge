import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerTradeRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['trades'],
        querystring: z.object({
          status: z.string().optional(),
          symbol: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { status, symbol, limit, offset } = req.query as {
        status?: string;
        symbol?: string;
        limit: number;
        offset: number;
      };
      const where = {
        ...(status ? { status: status as any } : {}),
        ...(symbol ? { symbol } : {}),
      };
      const [trades, total] = await Promise.all([
        prisma.tradePlan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            cycle: { select: { date: true } },
            outcome: true,
          },
        }),
        prisma.tradePlan.count({ where }),
      ]);
      return { trades, total, limit, offset };
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['trades'],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const trade = await prisma.tradePlan.findUnique({
        where: { id },
        include: {
          cycle: { select: { id: true, date: true, symbol: true, technicals: true } },
          outcome: true,
          critiques: { orderBy: { createdAt: 'desc' } },
          agentRun: { select: { id: true, agent: { select: { name: true } }, latencyMs: true } },
        },
      });
      if (!trade) return reply.notFound();
      return trade;
    },
  );
}
