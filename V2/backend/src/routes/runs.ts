import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerRunRoutes(app: FastifyInstance) {
  app.get(
    '/:id',
    {
      schema: {
        tags: ['runs'],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const run = await prisma.agentRun.findUnique({
        where: { id },
        include: {
          agent: { select: { name: true, displayName: true, kind: true } },
          promptVersion: true,
          cycle: { select: { id: true, symbol: true, date: true } },
          specialistAnalysis: true,
          tradePlan: true,
          toolCalls: { orderBy: { round: 'asc' } },
          critique: true,
        },
      });
      if (!run) return reply.notFound(`run ${id} not found`);
      return run;
    },
  );
}
