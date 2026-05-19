/**
 * Wallet ledger service. Balance = SUM(WalletTransaction.amount) over the
 * wallet's transactions, computed on every read — no denormalized balance
 * column, so the books cannot drift from the ledger.
 *
 * Two write paths:
 *   1. Operator deposit / withdrawal / adjustment via `recordTransaction`
 *      with explicit `author` + `reason` for the audit trail.
 *   2. Settler auto-books a `trade_settlement` row when a TradePlan closes
 *      and a TradeOutcome is created. `tradePlanId` is unique on the
 *      WalletTransaction table, so a re-run of the settler is naturally
 *      idempotent: the unique index throws on the second insert.
 *
 * Read access is wide-open within the backend (head trader reads the
 * balance for sizing context). Write access is gated to the operator routes
 * + the settler.
 */
import { prisma } from '../db';

const DEFAULT_WALLET_NAME = 'primary';

export type WalletTxKind = 'deposit' | 'withdrawal' | 'trade_settlement' | 'adjustment';

export interface RecordTxArgs {
  kind: WalletTxKind;
  /// Signed dollars. Deposits + winning settlements are positive; withdrawals
  /// + losing settlements are negative. The caller is responsible for sign
  /// correctness — the service validates direction matches kind for the two
  /// pure-direction kinds (deposit must be ≥0, withdrawal must be ≤0).
  amount: number;
  reason: string;
  author: string;
  tradePlanId?: string;
  walletName?: string;
}

export async function getOrCreateDefaultWallet(): Promise<{ id: string; name: string }> {
  const existing = await prisma.wallet.findUnique({ where: { name: DEFAULT_WALLET_NAME } });
  if (existing) return existing;
  return prisma.wallet.create({
    data: {
      name: DEFAULT_WALLET_NAME,
      description: 'Default shared wallet for agent trading.',
    },
  });
}

export async function getBalance(walletName: string = DEFAULT_WALLET_NAME): Promise<number> {
  const wallet = await prisma.wallet.findUnique({
    where: { name: walletName },
    select: { id: true },
  });
  if (!wallet) return 0;
  const agg = await prisma.walletTransaction.aggregate({
    where: { walletId: wallet.id },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

export async function recordTransaction(args: RecordTxArgs) {
  // Per-kind sign validation — defends against fat-fingered operators
  // submitting a positive "withdrawal" or negative "deposit".
  if (args.kind === 'deposit' && args.amount <= 0) {
    throw new Error('deposit amount must be > 0');
  }
  if (args.kind === 'withdrawal' && args.amount >= 0) {
    throw new Error('withdrawal amount must be < 0');
  }
  if (!args.reason.trim()) throw new Error('reason is required');
  if (!args.author.trim()) throw new Error('author is required');
  if (args.kind === 'trade_settlement' && !args.tradePlanId) {
    throw new Error('trade_settlement requires tradePlanId');
  }

  const wallet = await getOrCreateDefaultWallet();
  return prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      kind: args.kind,
      amount: args.amount,
      reason: args.reason,
      author: args.author,
      tradePlanId: args.tradePlanId ?? null,
    },
  });
}

export interface ListTxOpts {
  limit?: number;
  offset?: number;
  walletName?: string;
}

export async function listTransactions(opts: ListTxOpts = {}) {
  const wallet = await prisma.wallet.findUnique({
    where: { name: opts.walletName ?? DEFAULT_WALLET_NAME },
    select: { id: true },
  });
  if (!wallet) return { transactions: [], total: 0 };
  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);
  return { transactions, total };
}

/**
 * Convenience for the settler. Wraps `recordTransaction` with kind=trade_settlement
 * and swallows the unique-constraint violation that would fire on a re-run
 * (since `tradePlanId` is unique on WalletTransaction). The settler can
 * therefore be re-run safely without double-booking realized P&L.
 */
export async function bookTradeSettlement(
  tradePlanId: string,
  realizedPnl: number,
  symbol: string,
  closeReason: string,
): Promise<void> {
  try {
    await recordTransaction({
      kind: 'trade_settlement',
      amount: realizedPnl,
      reason: `${symbol} ${closeReason}`,
      author: 'settler',
      tradePlanId,
    });
  } catch (e: any) {
    // Prisma's unique-constraint code is P2002. Quietly treat as a no-op so
    // the settler stays idempotent.
    if (e?.code !== 'P2002') throw e;
  }
}
