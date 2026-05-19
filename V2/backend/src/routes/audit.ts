import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { computeCalibration } from '../audit/calibration';
import { computeDrift } from '../audit/drift';
import { computeAgreementMatrix } from '../audit/agreement';
import { computeInfluence } from '../audit/influence';
import { computeStability } from '../audit/stability';
import { computePredictionScores, computeAgentPredictionScore } from '../audit/predictionScore';

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get(
    '/calibration/:agentName',
    {
      schema: {
        tags: ['audit'],
        params: z.object({ agentName: z.string() }),
        querystring: z.object({ buckets: z.coerce.number().int().min(2).max(20).default(10) }),
      },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const { buckets } = req.query as { buckets: number };
      const agent = await prisma.agent.findUnique({ where: { name: agentName } });
      if (!agent) return reply.notFound();
      return computeCalibration(agent.id, buckets);
    },
  );

  app.get(
    '/drift/:agentName',
    {
      schema: {
        tags: ['audit'],
        params: z.object({ agentName: z.string() }),
        querystring: z.object({ rollingDays: z.coerce.number().int().min(7).max(180).default(30) }),
      },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const { rollingDays } = req.query as { rollingDays: number };
      const agent = await prisma.agent.findUnique({ where: { name: agentName } });
      if (!agent) return reply.notFound();
      return computeDrift(agent.id, rollingDays);
    },
  );

  app.get(
    '/agreement',
    { schema: { tags: ['audit'] } },
    async () => computeAgreementMatrix(),
  );

  app.get(
    '/influence/:agentName',
    {
      schema: {
        tags: ['audit'],
        params: z.object({ agentName: z.string() }),
      },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const agent = await prisma.agent.findUnique({ where: { name: agentName } });
      if (!agent) return reply.notFound();
      return computeInfluence(agent.id);
    },
  );

  app.get(
    '/prediction-scores',
    { schema: { tags: ['audit'] } },
    async () => computePredictionScores(),
  );

  app.get(
    '/prediction-scores/:agentName',
    {
      schema: {
        tags: ['audit'],
        params: z.object({ agentName: z.string() }),
      },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const score = await computeAgentPredictionScore(agentName);
      if (!score) return reply.notFound();
      return score;
    },
  );

  app.get(
    '/stability/:agentName',
    {
      schema: {
        tags: ['audit'],
        params: z.object({ agentName: z.string() }),
      },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const agent = await prisma.agent.findUnique({ where: { name: agentName } });
      if (!agent) return reply.notFound();
      return computeStability(agent.id);
    },
  );
}
