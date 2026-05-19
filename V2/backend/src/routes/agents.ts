import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { computeAgentSummary } from '../audit/agentSummary';

export async function registerAgentRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['agents'],
        querystring: z.object({ kind: z.string().optional(), active: z.coerce.boolean().optional() }),
      },
    },
    async (req) => {
      const { kind, active } = req.query as { kind?: string; active?: boolean };
      const agents = await prisma.agent.findMany({
        where: {
          ...(kind ? { kind: kind as any } : {}),
          ...(active !== undefined ? { isActive: active } : {}),
        },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { runs: true, promptVersions: true } },
        },
      });
      return agents;
    },
  );

  app.get(
    '/:name',
    {
      schema: {
        tags: ['agents'],
        params: z.object({ name: z.string() }),
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const agent = await prisma.agent.findUnique({
        where: { name },
        include: {
          promptVersions: { orderBy: { createdAt: 'desc' } },
          _count: { select: { runs: true } },
        },
      });
      if (!agent) return reply.notFound(`agent '${name}' not found`);
      return agent;
    },
  );

  app.get(
    '/:name/summary',
    {
      schema: {
        tags: ['agents'],
        params: z.object({ name: z.string() }),
        querystring: z.object({ window: z.enum(['7d', '30d', '90d', 'all']).default('30d') }),
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const { window } = req.query as { window: '7d' | '30d' | '90d' | 'all' };
      const agent = await prisma.agent.findUnique({ where: { name } });
      if (!agent) return reply.notFound(`agent '${name}' not found`);
      return computeAgentSummary(agent.id, window);
    },
  );

  app.get(
    '/:name/runs',
    {
      schema: {
        tags: ['agents'],
        params: z.object({ name: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          schemaValid: z.coerce.boolean().optional(),
          runKind: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const { limit, offset, schemaValid, runKind } = req.query as {
        limit: number;
        offset: number;
        schemaValid?: boolean;
        runKind?: string;
      };
      const agent = await prisma.agent.findUnique({ where: { name } });
      if (!agent) return reply.notFound(`agent '${name}' not found`);

      const where = {
        agentId: agent.id,
        ...(schemaValid !== undefined ? { schemaValid } : {}),
        ...(runKind ? { runKind } : {}),
      };
      const [runs, total] = await Promise.all([
        prisma.agentRun.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            promptVersion: { select: { version: true } },
            cycle: { select: { symbol: true, date: true } },
          },
        }),
        prisma.agentRun.count({ where }),
      ]);
      return { runs, total, limit, offset };
    },
  );
}
