import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPrismaClient } from '../prisma';

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  dbReachable: z.boolean(),
  version: z.string(),
  uptimeSec: z.number(),
});

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/health',
    {
      schema: {
        response: { 200: HealthResponseSchema },
        tags: ['health'],
        summary: 'Service health check',
      },
    },
    async () => {
      let dbReachable = false;
      try {
        const prisma = getPrismaClient();
        await prisma.$queryRaw`SELECT 1`;
        dbReachable = true;
      } catch (err) {
        app.log.warn({ err }, 'health: database unreachable');
      }
      return {
        status: dbReachable ? ('ok' as const) : ('degraded' as const),
        dbReachable,
        version: '0.1.0',
        uptimeSec: Math.floor(process.uptime()),
      };
    }
  );
};
