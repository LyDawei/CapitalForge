import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: z.object({ status: z.literal('ok'), db: z.enum(['up', 'down']) }),
        },
      },
    },
    async () => {
      let db: 'up' | 'down' = 'up';
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        db = 'down';
      }
      return { status: 'ok' as const, db };
    },
  );
}
