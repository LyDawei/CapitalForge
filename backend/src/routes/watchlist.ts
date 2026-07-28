import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { runGrowthScout } from '../runner/growthScout';

export async function registerWatchlistRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /api/watchlist/proposals — paginated, filterable by status.
  // -----------------------------------------------------------------------
  app.get(
    '/proposals',
    {
      schema: {
        tags: ['watchlist'],
        querystring: z.object({
          status: z.enum(['proposed', 'approved', 'rejected', 'superseded']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { status, limit, offset } = req.query as {
        status?: 'proposed' | 'approved' | 'rejected' | 'superseded';
        limit: number;
        offset: number;
      };
      const where = status ? { status } : {};
      const [proposals, total] = await Promise.all([
        prisma.watchlistProposal.findMany({
          where,
          orderBy: { proposedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.watchlistProposal.count({ where }),
      ]);
      return { proposals, total, limit, offset };
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/watchlist/discover — manual trigger for the growthScout run.
  // Returns counts (candidates screened / evaluated / proposals created /
  // total LLM cost). Long-running: 50 candidates × 1 LLM call ≈ 30–90s
  // depending on provider.
  // -----------------------------------------------------------------------
  app.post('/discover', { schema: { tags: ['watchlist'] } }, async () => runGrowthScout());

  // -----------------------------------------------------------------------
  // POST /api/watchlist/proposals/:id/approve — moves symbol into the live
  // watchlist by writing a new StrategyConfig row (the existing append-only
  // ledger pattern). Marks the proposal `approved` with audit fields set.
  // -----------------------------------------------------------------------
  app.post(
    '/proposals/:id/approve',
    {
      schema: {
        tags: ['watchlist'],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ approvedBy: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { approvedBy } = req.body as { approvedBy: string };
      const proposal = await prisma.watchlistProposal.findUnique({ where: { id } });
      if (!proposal) return reply.notFound();
      if (proposal.status !== 'proposed') {
        return reply.badRequest(`proposal is ${proposal.status}, only 'proposed' can be approved`);
      }
      const strategy = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } });
      if (!strategy) return reply.badRequest('no StrategyConfig exists — seed one first');
      if (strategy.watchlist.includes(proposal.symbol)) {
        // Already in watchlist via some other path; just mark approved.
        await prisma.watchlistProposal.update({
          where: { id },
          data: {
            status: 'approved',
            decidedAt: new Date(),
            decidedBy: approvedBy,
          },
        });
        return { id, status: 'approved', note: 'already in watchlist, no StrategyConfig change' };
      }
      // Append the symbol via a new StrategyConfig row (append-only pattern).
      await prisma.strategyConfig.create({
        data: {
          presetName: 'custom',
          strategyBias: strategy.strategyBias,
          holdingPeriod: strategy.holdingPeriod,
          avoidEarnings: strategy.avoidEarnings,
          avoidEarningsWindowDays: strategy.avoidEarningsWindowDays,
          watchlist: [...strategy.watchlist, proposal.symbol],
          allocatedCapital: strategy.allocatedCapital,
          reason: `Approved watchlist proposal for ${proposal.symbol}`,
          author: approvedBy,
        },
      });
      await prisma.watchlistProposal.update({
        where: { id },
        data: {
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: approvedBy,
        },
      });
      return { id, status: 'approved', addedToWatchlist: proposal.symbol };
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/watchlist/proposals/:id/reject — rejection with required reason.
  // Symbol remains eligible for re-proposal in future discovery runs (the
  // scout doesn't auto-exclude rejected names — operator can decide if the
  // thesis has changed since).
  // -----------------------------------------------------------------------
  app.post(
    '/proposals/:id/reject',
    {
      schema: {
        tags: ['watchlist'],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ rejectedBy: z.string().min(1), reason: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { rejectedBy, reason } = req.body as { rejectedBy: string; reason: string };
      const proposal = await prisma.watchlistProposal.findUnique({ where: { id } });
      if (!proposal) return reply.notFound();
      if (proposal.status !== 'proposed') {
        return reply.badRequest(`proposal is ${proposal.status}, only 'proposed' can be rejected`);
      }
      await prisma.watchlistProposal.update({
        where: { id },
        data: {
          status: 'rejected',
          decidedAt: new Date(),
          decidedBy: rejectedBy,
          rejectedReason: reason,
        },
      });
      return { id, status: 'rejected' };
    },
  );
}
