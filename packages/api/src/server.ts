import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health';
import { cycleRoutes } from './routes/cycles';
import { portfolioRoutes } from './routes/portfolio';
import { agentRoutes } from './routes/agents';
import { performanceRoutes } from './routes/performance';
import { notesRoutes } from './routes/notes';
import { walletRoutes } from './routes/wallet';
import { riskConfigRoutes } from './routes/riskConfig';
import { getPrismaClient, closePrismaClient } from './prisma';

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '0.0.0.0';

async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CapitalForge API',
        description: 'Read-only HTTP API for the CapitalForge trading engine',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.decorate('prisma', getPrismaClient());

  // Guest mode: extract ?guest=true from query string and enforce read-only on mutations
  app.addHook('onRequest', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const isGuest = query.guest === 'true';
    (req as any).isGuest = isGuest;

    if (isGuest && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
      // Skip guest check for health and read-only endpoints
      if (req.url.startsWith('/api/admin') || req.url.includes('/notes')) {
        reply.code(403).send({ error: { code: 'GUEST_FORBIDDEN', message: 'Guest users cannot modify data' } });
      }
    }
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(cycleRoutes, { prefix: '/api' });
  await app.register(portfolioRoutes, { prefix: '/api' });
  await app.register(agentRoutes, { prefix: '/api' });
  await app.register(performanceRoutes, { prefix: '/api' });
  await app.register(notesRoutes, { prefix: '/api' });
  await app.register(walletRoutes, { prefix: '/api' });
  await app.register(riskConfigRoutes, { prefix: '/api' });

  app.addHook('onClose', async () => {
    await closePrismaClient();
  });

  return app;
}

async function start() {
  const app = await build();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API listening on http://${HOST}:${PORT}`);
    app.log.info(`Swagger UI: http://${HOST}:${PORT}/api/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

export { build };
