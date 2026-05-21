import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { env } from './env';
import { prisma } from './db';
import { registerHealthRoutes } from './routes/health';
import { registerAgentRoutes } from './routes/agents';
import { registerRunRoutes } from './routes/runs';
import { registerPromptRoutes } from './routes/prompts';
import { registerCycleRoutes } from './routes/cycles';
import { registerTradeRoutes } from './routes/trades';
import { registerAuditRoutes } from './routes/audit';
import { registerCritiqueRoutes } from './routes/critiques';
import { registerAnomalyRoutes } from './routes/anomalies';
import { registerRunnerRoutes } from './routes/runner';
import { registerConfigRoutes } from './routes/config';
import { registerBasePromptRoutes } from './routes/basePrompts';
import { registerWalletRoutes } from './routes/wallet';
import { registerFeedRoutes } from './routes/feeds';
import { registerWatchlistRoutes } from './routes/watchlist';
import { registerAlpacaRoutes } from './routes/alpaca';

async function build() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(sensible);
  await app.register(swagger, {
    openapi: {
      info: { title: 'CapitalForge V2 — Agent Audit API', version: '0.1.0' },
      servers: [{ url: `http://localhost:${env.PORT}` }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(registerHealthRoutes, { prefix: '/api' });
  await app.register(registerAgentRoutes, { prefix: '/api/agents' });
  await app.register(registerRunRoutes, { prefix: '/api/runs' });
  await app.register(registerPromptRoutes, { prefix: '/api/prompts' });
  await app.register(registerCycleRoutes, { prefix: '/api/cycles' });
  await app.register(registerTradeRoutes, { prefix: '/api/trades' });
  await app.register(registerAuditRoutes, { prefix: '/api/audit' });
  await app.register(registerCritiqueRoutes, { prefix: '/api/critiques' });
  await app.register(registerAnomalyRoutes, { prefix: '/api/anomalies' });
  await app.register(registerRunnerRoutes, { prefix: '/api/runner' });
  await app.register(registerConfigRoutes, { prefix: '/api/config' });
  await app.register(registerBasePromptRoutes, { prefix: '/api/base-prompts' });
  await app.register(registerWalletRoutes, { prefix: '/api/wallet' });
  await app.register(registerFeedRoutes, { prefix: '/api/feeds' });
  await app.register(registerWatchlistRoutes, { prefix: '/api/watchlist' });
  await app.register(registerAlpacaRoutes, { prefix: '/api/alpaca' });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

async function main() {
  const app = await build();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API ready on http://localhost:${env.PORT} (docs: /docs)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
