import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getCurrentRiskConfig,
  listRiskConfigHistory,
  updateRiskConfig,
  DEFAULT_RISK_CONFIG,
} from '@capitalforge/engine';
import { getPrismaClient } from '../prisma';

const UpdateBodySchema = z.object({
  riskTolerancePct: z.number().min(0).max(2).optional(),
  maxRiskPctPerTrade: z.number().min(0).max(0.05).optional(),
  maxConcurrentPositions: z.number().int().min(1).max(20).optional(),
  drawdownHalveAt: z.number().min(0).max(0.5).optional(),
  drawdownCloseOnlyAt: z.number().min(0).max(0.5).optional(),
  drawdownHardHaltAt: z.number().min(0).max(1.0).optional(),
  defaultStopLossPct: z.number().min(0).max(0.5).optional(),
  defaultTarget1R: z.number().min(0.5).max(10).optional(),
  defaultTarget2R: z.number().min(0.5).max(20).optional(),
  defaultTimeStopBars: z.number().int().min(1).max(100).optional(),
  reason: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const riskConfigRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/risk-config',
    {
      schema: {
        tags: ['risk-config'],
        summary: 'Current active risk + strategy config + recent history',
      },
    },
    async () => {
      const [current, history] = await Promise.all([
        getCurrentRiskConfig(prisma),
        listRiskConfigHistory(prisma, 20),
      ]);
      return {
        current,
        defaults: DEFAULT_RISK_CONFIG,
        history,
      };
    }
  );

  app.get(
    '/risk-config/history',
    {
      schema: {
        querystring: HistoryQuerySchema,
        tags: ['risk-config'],
        summary: 'Risk config change history',
      },
    },
    async (req) => {
      return listRiskConfigHistory(prisma, req.query.limit);
    }
  );

  app.post(
    '/risk-config',
    {
      schema: {
        body: UpdateBodySchema,
        tags: ['risk-config'],
        summary: 'Update one or more risk knobs (unspecified fields inherit current values)',
      },
    },
    async (req, reply) => {
      try {
        const result = await updateRiskConfig(req.body, prisma);
        return result;
      } catch (err) {
        reply.code(400);
        return {
          error: {
            code: 'RISK_CONFIG_REJECTED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
  );
};
