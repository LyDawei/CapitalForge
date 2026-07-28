import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerCycleRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['cycles'],
        querystring: z.object({
          symbol: z.string().optional(),
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { symbol, status, limit, offset } = req.query as {
        symbol?: string;
        status?: string;
        limit: number;
        offset: number;
      };
      const where = {
        ...(symbol ? { symbol } : {}),
        ...(status ? { status: status as any } : {}),
      };
      const [cycles, total] = await Promise.all([
        prisma.cycle.findMany({
          where,
          orderBy: { date: 'desc' },
          take: limit,
          skip: offset,
          include: {
            tradePlan: { select: { action: true, conviction: true, status: true } },
            _count: { select: { specialistAnalyses: true, anomalies: true } },
          },
        }),
        prisma.cycle.count({ where }),
      ]);
      return { cycles, total, limit, offset };
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['cycles'],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const cycle = await prisma.cycle.findUnique({
        where: { id },
        include: {
          specialistAnalyses: {
            orderBy: { createdAt: 'asc' },
            include: { agentRun: { select: { latencyMs: true, modelName: true, schemaValid: true } } },
          },
          deliberation: true,
          tradePlan: { include: { outcome: true } },
          critiques: { orderBy: { createdAt: 'desc' } },
          anomalies: { orderBy: { createdAt: 'desc' } },
          runs: {
            select: {
              id: true,
              agentId: true,
              modelName: true,
              latencyMs: true,
              tokensIn: true,
              tokensOut: true,
              costUsd: true,
              schemaValid: true,
              runKind: true,
              createdAt: true,
              agent: { select: { name: true, displayName: true, kind: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!cycle) return reply.notFound();
      return cycle;
    },
  );
}
