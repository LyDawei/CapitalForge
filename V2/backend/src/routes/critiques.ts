import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerCritiqueRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['critiques'],
        querystring: z.object({
          author: z.string().optional(),
          severity: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { author, severity, limit, offset } = req.query as {
        author?: string;
        severity?: string;
        limit: number;
        offset: number;
      };
      const where = {
        ...(author ? { author } : {}),
        ...(severity ? { severity: severity as any } : {}),
      };
      const [critiques, total] = await Promise.all([
        prisma.critique.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            cycle: { select: { date: true, symbol: true } },
            tradePlan: { select: { id: true, action: true, symbol: true } },
          },
        }),
        prisma.critique.count({ where }),
      ]);
      return { critiques, total, limit, offset };
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['critiques'],
        body: z.object({
          cycleId: z.string().uuid().optional(),
          agentRunId: z.string().uuid().optional(),
          tradePlanId: z.string().uuid().optional(),
          author: z.string(),
          severity: z.enum(['info', 'warn', 'error']).default('info'),
          body: z.string().min(1),
          tags: z.array(z.string()).default([]),
        }),
      },
    },
    async (req, reply) => {
      const c = await prisma.critique.create({ data: req.body as any });
      reply.code(201);
      return c;
    },
  );
}
