import type { FastifyInstance } from 'fastify';
import { getAlpacaService } from '../services/alpaca';

export async function registerAlpacaRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /api/alpaca/account-summary — combined dashboard data.
  //
  // Three Alpaca trading-API reads in parallel (account, positions, recent
  // orders) returned as a single JSON payload so the dashboard hits one
  // endpoint instead of three. Tolerates per-endpoint failure: if positions
  // 500s but account succeeds, the response still includes the account with
  // an `errors[]` field describing what was missed.
  // -----------------------------------------------------------------------
  app.get('/account-summary', { schema: { tags: ['alpaca'] } }, async () => {
    const alpaca = getAlpacaService();
    const errors: Array<{ kind: string; message: string }> = [];

    const [accountRes, positionsRes, ordersRes] = await Promise.allSettled([
      alpaca.getAccount(),
      alpaca.getPositions(),
      alpaca.getRecentOrders(20),
    ]);

    const account = accountRes.status === 'fulfilled' ? accountRes.value : null;
    if (accountRes.status === 'rejected') {
      errors.push({ kind: 'account', message: String(accountRes.reason?.message ?? accountRes.reason) });
    }
    const positions = positionsRes.status === 'fulfilled' ? positionsRes.value : [];
    if (positionsRes.status === 'rejected') {
      errors.push({ kind: 'positions', message: String(positionsRes.reason?.message ?? positionsRes.reason) });
    }
    const orders = ordersRes.status === 'fulfilled' ? ordersRes.value : [];
    if (ordersRes.status === 'rejected') {
      errors.push({ kind: 'orders', message: String(ordersRes.reason?.message ?? ordersRes.reason) });
    }

    return { account, positions, orders, errors };
  });
}
