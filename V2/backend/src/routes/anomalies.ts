import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerAnomalyRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['anomalies'],
        querystring: z.object({
          kind: z.string().optional(),
          severity: z.string().optional(),
          acknowledged: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { kind, severity, acknowledged, limit } = req.query as {
        kind?: string;
        severity?: string;
        acknowledged?: boolean;
        limit: number;
      };
      const where = {
        ...(kind ? { kind: kind as any } : {}),
        ...(severity ? { severity: severity as any } : {}),
        ...(acknowledged === true ? { NOT: { acknowledgedAt: null } } : {}),
        ...(acknowledged === false ? { acknowledgedAt: null } : {}),
      };
      return prisma.anomaly.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
    },
  );

  app.post(
    '/:id/ack',
    {
      schema: {
        tags: ['anomalies'],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ by: z.string() }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { by } = req.body as { by: string };
      return prisma.anomaly.update({
        where: { id },
        data: { acknowledgedAt: new Date(), acknowledgedBy: by },
      });
    },
  );
}
