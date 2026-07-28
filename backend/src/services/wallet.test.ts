import { recordTransaction, getBalance, listTransactions, bookTradeSettlement } from './wallet';
import { prisma } from '../db';

// Integration tests against the dev DB. Each test scopes itself by recording
// transactions and asserting against a delta — never relying on the
// pre-existing wallet state. We don't bind to a unique wallet name because
// every operator action goes through the singleton "primary" wallet; the
// recorded transactions ARE the test fixtures, and we clean them up in
// afterEach by row id.

const createdIds: string[] = [];

afterEach(async () => {
  if (createdIds.length === 0) return;
  await prisma.walletTransaction.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function balanceDelta(fn: () => Promise<void>): Promise<number> {
  const before = await getBalance();
  await fn();
  const after = await getBalance();
  return +(after - before).toFixed(2);
}

describe('wallet service', () => {
  it('rejects a deposit with non-positive amount', async () => {
    await expect(
      recordTransaction({
        kind: 'deposit',
        amount: 0,
        reason: 'broken',
        author: 'test',
      }),
    ).rejects.toThrow(/deposit amount must be > 0/);
    await expect(
      recordTransaction({
        kind: 'deposit',
        amount: -100,
        reason: 'broken',
        author: 'test',
      }),
    ).rejects.toThrow(/deposit amount must be > 0/);
  });

  it('rejects a withdrawal with non-negative amount', async () => {
    await expect(
      recordTransaction({
        kind: 'withdrawal',
        amount: 100,
        reason: 'broken',
        author: 'test',
      }),
    ).rejects.toThrow(/withdrawal amount must be < 0/);
  });

  it('rejects when reason or author is missing', async () => {
    await expect(
      recordTransaction({ kind: 'deposit', amount: 100, reason: '', author: 'test' }),
    ).rejects.toThrow(/reason is required/);
    await expect(
      recordTransaction({ kind: 'deposit', amount: 100, reason: 'ok', author: '   ' }),
    ).rejects.toThrow(/author is required/);
  });

  it('rejects trade_settlement without tradePlanId', async () => {
    await expect(
      recordTransaction({
        kind: 'trade_settlement',
        amount: 25,
        reason: 'win',
        author: 'settler',
      }),
    ).rejects.toThrow(/trade_settlement requires tradePlanId/);
  });

  it('deposit increases balance', async () => {
    const delta = await balanceDelta(async () => {
      const tx = await recordTransaction({
        kind: 'deposit',
        amount: 300,
        reason: 'unit test deposit',
        author: 'jest',
      });
      createdIds.push(tx.id);
    });
    expect(delta).toBe(300);
  });

  it('withdrawal decreases balance', async () => {
    const delta = await balanceDelta(async () => {
      const tx = await recordTransaction({
        kind: 'withdrawal',
        amount: -75,
        reason: 'unit test withdrawal',
        author: 'jest',
      });
      createdIds.push(tx.id);
    });
    expect(delta).toBe(-75);
  });

  it('top-up is additive — second deposit adds to the first, not overwrites', async () => {
    // Two deposits, $300 then $50 → ledger reflects a +350 delta.
    const delta = await balanceDelta(async () => {
      const a = await recordTransaction({
        kind: 'deposit',
        amount: 300,
        reason: 'initial fund',
        author: 'jest',
      });
      const b = await recordTransaction({
        kind: 'deposit',
        amount: 50,
        reason: 'top up after initial losses',
        author: 'jest',
      });
      createdIds.push(a.id, b.id);
    });
    expect(delta).toBe(350);
  });

  it('lists transactions newest-first', async () => {
    const a = await recordTransaction({
      kind: 'deposit',
      amount: 100,
      reason: 'list test A',
      author: 'jest',
    });
    // Brief gap to ensure b.createdAt > a.createdAt at the DB level.
    await new Promise((r) => setTimeout(r, 10));
    const b = await recordTransaction({
      kind: 'deposit',
      amount: 200,
      reason: 'list test B',
      author: 'jest',
    });
    createdIds.push(a.id, b.id);

    const { transactions } = await listTransactions({ limit: 50 });
    const indexA = transactions.findIndex((t) => t.id === a.id);
    const indexB = transactions.findIndex((t) => t.id === b.id);
    expect(indexA).toBeGreaterThan(indexB); // newer (b) appears earlier in the list
  });

  it('bookTradeSettlement is idempotent on tradePlanId', async () => {
    // First call creates the row; second silently no-ops (P2002 unique
    // violation is caught). The settler can be re-run without double-booking.
    const fakePlanId = `test-plan-${Date.now()}`;

    await bookTradeSettlement(fakePlanId, -42.5, 'TEST', 'stop_hit');
    await bookTradeSettlement(fakePlanId, -42.5, 'TEST', 'stop_hit');

    const rows = await prisma.walletTransaction.findMany({ where: { tradePlanId: fakePlanId } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(-42.5);
    expect(rows[0]!.kind).toBe('trade_settlement');
    expect(rows[0]!.author).toBe('settler');

    createdIds.push(rows[0]!.id);
  });
});
