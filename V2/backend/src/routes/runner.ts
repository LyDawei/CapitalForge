import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCycle } from '../runner';
import { settleProposedPlans } from '../runner/settler';
import { runAnomalyDetector } from '../audit/anomalyDetector';

export async function registerRunnerRoutes(app: FastifyInstance) {
  app.post(
    '/run-cycle',
    {
      schema: {
        tags: ['runner'],
        body: z.object({
          symbol: z.string().min(1).max(10).default('SPY'),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayStr()),
        }),
      },
    },
    async (req) => {
      const { symbol, date } = req.body as { symbol: string; date: string };
      return runCycle(symbol, date);
    },
  );

  app.post(
    '/settle',
    {
      schema: { tags: ['runner'] },
    },
    async () => {
      const count = await settleProposedPlans();
      return { settled: count };
    },
  );

  app.post(
    '/detect-anomalies',
    { schema: { tags: ['runner'] } },
    async () => runAnomalyDetector(),
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
