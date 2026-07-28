import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBalance, listTransactions, recordTransaction } from '../services/wallet';

export async function registerWalletRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /api/wallet — current balance + the 10 most recent transactions.
  // -----------------------------------------------------------------------
  app.get('/', { schema: { tags: ['wallet'] } }, async () => {
    const [balance, recent] = await Promise.all([
      getBalance(),
      listTransactions({ limit: 10 }),
    ]);
    return {
      balance,
      transactionCount: recent.total,
      recentTransactions: recent.transactions,
    };
  });

  // -----------------------------------------------------------------------
  // GET /api/wallet/transactions — paginated ledger.
  // -----------------------------------------------------------------------
  app.get(
    '/transactions',
    {
      schema: {
        tags: ['wallet'],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { limit, offset } = req.query as { limit: number; offset: number };
      const { transactions, total } = await listTransactions({ limit, offset });
      return { transactions, total, limit, offset };
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/wallet/transactions — operator deposit or withdrawal.
  //
  // Body: { kind: 'deposit'|'withdrawal'|'adjustment', amount, reason, author }.
  // - kind=deposit must have amount > 0.
  // - kind=withdrawal must have amount < 0 (the UI form usually flips the
  //   sign on the user's behalf; this endpoint requires the signed value
  //   explicitly so a curl mistake can't move money the wrong way).
  // - reason + author are required for the audit trail.
  // trade_settlement is intentionally NOT allowed here — only the settler
  // (or a manual DB op) writes settlement rows.
  // -----------------------------------------------------------------------
  app.post(
    '/transactions',
    {
      schema: {
        tags: ['wallet'],
        body: z.object({
          kind: z.enum(['deposit', 'withdrawal', 'adjustment']),
          amount: z.number().refine((n) => n !== 0, 'amount must be non-zero'),
          reason: z.string().min(1),
          author: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      const { kind, amount, reason, author } = req.body as {
        kind: 'deposit' | 'withdrawal' | 'adjustment';
        amount: number;
        reason: string;
        author: string;
      };
      try {
        const tx = await recordTransaction({ kind, amount, reason, author });
        reply.code(201);
        return tx;
      } catch (e: any) {
        return reply.badRequest(e.message);
      }
    },
  );
}
