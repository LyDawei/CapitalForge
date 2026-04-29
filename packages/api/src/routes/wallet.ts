import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  applyAllocationChange,
  getCurrentAllocation,
  listAllocationHistory,
  getLatestSandboxState,
} from '@capitalforge/engine';
import { getPrismaClient } from '../prisma';

const AllocateBodySchema = z.object({
  allocatedCapital: z.number().min(0),
  reason: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const walletRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/wallet',
    {
      schema: {
        tags: ['wallet'],
        summary: 'Current wallet allocation + sandbox snapshot + recent history',
      },
    },
    async () => {
      const [allocation, sandbox, history] = await Promise.all([
        getCurrentAllocation(prisma),
        getLatestSandboxState(),
        listAllocationHistory(prisma, 20),
      ]);
      return {
        allocation,
        sandbox,
        history,
      };
    }
  );

  app.get(
    '/wallet/history',
    {
      schema: {
        querystring: HistoryQuerySchema,
        tags: ['wallet'],
        summary: 'Allocation change history',
      },
    },
    async (req) => {
      return listAllocationHistory(prisma, req.query.limit);
    }
  );

  app.post(
    '/wallet/allocate',
    {
      schema: {
        body: AllocateBodySchema,
        tags: ['wallet'],
        summary: 'Update the wallet allocation (delta applied to cashBalance)',
      },
    },
    async (req, reply) => {
      try {
        const result = await applyAllocationChange(
          {
            newAllocation: req.body.allocatedCapital,
            reason: req.body.reason,
            author: req.body.author,
          },
          prisma
        );
        return result;
      } catch (err) {
        reply.code(400);
        return {
          error: {
            code: 'ALLOCATION_REJECTED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
  );
};
