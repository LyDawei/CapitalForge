import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import {
  RISK_PRESETS,
  STRATEGY_PRESETS,
  getRiskPreset,
  getStrategyPreset,
} from '../config/presets';

export async function registerConfigRoutes(app: FastifyInstance) {
  // ---- Presets (read-only) ----
  app.get('/presets', { schema: { tags: ['config'] } }, async () => ({
    risk: RISK_PRESETS,
    strategy: STRATEGY_PRESETS,
  }));

  // ---- Risk config ----
  app.get('/risk', { schema: { tags: ['config'] } }, async () => {
    const latest = await prisma.riskConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latest) {
      // Create a default on first access
      return prisma.riskConfig.create({ data: { reason: 'auto-created on first access' } });
    }
    return latest;
  });

  app.get(
    '/risk/history',
    {
      schema: {
        tags: ['config'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      },
    },
    async (req) => {
      const { limit } = req.query as { limit: number };
      return prisma.riskConfig.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    },
  );

  app.post(
    '/risk',
    {
      schema: {
        tags: ['config'],
        body: z.object({
          preset: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
          riskTolerancePct: z.number().min(0.1).max(2.0).optional(),
          maxRiskPctPerTrade: z.number().min(0.001).max(0.1).optional(),
          maxConcurrentPositions: z.number().int().min(1).max(20).optional(),
          drawdownHalveAt: z.number().min(0.01).max(0.5).optional(),
          drawdownCloseOnlyAt: z.number().min(0.01).max(0.5).optional(),
          drawdownHardHaltAt: z.number().min(0.01).max(0.5).optional(),
          defaultStopLossPct: z.number().min(0.005).max(0.2).optional(),
          defaultTarget1R: z.number().min(0.5).max(10).optional(),
          defaultTarget2R: z.number().min(0.5).max(10).optional(),
          defaultTimeStopBars: z.number().int().min(1).max(60).optional(),
          reason: z.string().optional(),
          author: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      let values: any = {};
      let presetName = 'custom';

      if (body.preset) {
        const p = getRiskPreset(body.preset);
        if (!p) return reply.badRequest(`unknown preset ${body.preset}`);
        values = { ...p.values };
        presetName = p.name;
      }

      // Apply any explicit overrides
      const overrides = { ...body };
      delete overrides.preset;
      delete overrides.reason;
      delete overrides.author;
      values = { ...values, ...overrides };

      // If any value was overridden away from the preset, mark as custom
      if (body.preset) {
        const p = getRiskPreset(body.preset)!;
        const drifted = Object.entries(overrides).some(
          ([k, v]) => v !== undefined && (p.values as any)[k] !== v,
        );
        if (drifted) presetName = 'custom';
      } else {
        presetName = 'custom';
      }

      const created = await prisma.riskConfig.create({
        data: {
          ...values,
          presetName,
          reason: body.reason ?? null,
          author: body.author ?? 'user',
        },
      });
      reply.code(201);
      return created;
    },
  );

  // ---- Strategy config ----
  app.get('/strategy', { schema: { tags: ['config'] } }, async () => {
    const latest = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latest) return prisma.strategyConfig.create({ data: { reason: 'auto-created on first access' } });
    return latest;
  });

  app.get(
    '/strategy/history',
    {
      schema: {
        tags: ['config'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      },
    },
    async (req) => {
      const { limit } = req.query as { limit: number };
      return prisma.strategyConfig.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    },
  );

  app.post(
    '/strategy',
    {
      schema: {
        tags: ['config'],
        body: z.object({
          preset: z.enum(['trend_following', 'mean_reversion', 'balanced']).optional(),
          strategyBias: z.enum(['trend_following', 'mean_reversion', 'balanced']).optional(),
          holdingPeriod: z.enum(['short_term', 'medium_term', 'long_term']).optional(),
          avoidEarnings: z.boolean().optional(),
          avoidEarningsWindowDays: z.number().int().min(0).max(14).optional(),
          watchlist: z.array(z.string().min(1).max(10)).max(50).optional(),
          allocatedCapital: z.number().min(100).max(10_000_000).optional(),
          reason: z.string().optional(),
          author: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      let values: any = {};
      let presetName = 'custom';

      if (body.preset) {
        const p = getStrategyPreset(body.preset);
        if (!p) return reply.badRequest(`unknown preset ${body.preset}`);
        values.strategyBias = p.bias;
        presetName = p.name;
      }

      // Carry forward fields the user didn't change from the latest row
      const latest = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } });
      const merged = {
        strategyBias: values.strategyBias ?? body.strategyBias ?? latest?.strategyBias ?? 'balanced',
        holdingPeriod: body.holdingPeriod ?? latest?.holdingPeriod ?? 'medium_term',
        avoidEarnings: body.avoidEarnings ?? latest?.avoidEarnings ?? true,
        avoidEarningsWindowDays: body.avoidEarningsWindowDays ?? latest?.avoidEarningsWindowDays ?? 3,
        watchlist: body.watchlist ?? latest?.watchlist ?? ['SPY', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'],
        allocatedCapital: body.allocatedCapital ?? latest?.allocatedCapital ?? 2000,
      };

      // If any field other than the preset-controlled `strategyBias` was changed, mark custom
      if (body.preset) {
        const changedOtherFields =
          body.holdingPeriod !== undefined ||
          body.avoidEarnings !== undefined ||
          body.avoidEarningsWindowDays !== undefined ||
          body.watchlist !== undefined ||
          body.allocatedCapital !== undefined;
        if (changedOtherFields) presetName = 'custom';
      } else {
        presetName = 'custom';
      }

      const created = await prisma.strategyConfig.create({
        data: {
          ...merged,
          presetName,
          reason: body.reason ?? null,
          author: body.author ?? 'user',
        },
      });
      reply.code(201);
      return created;
    },
  );
}
