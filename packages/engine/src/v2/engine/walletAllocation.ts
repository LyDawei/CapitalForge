import { PrismaClient } from '@prisma/client';
import type { SandboxContext } from '@capitalforge/shared';
import { getTodayDate, calculateDrawdown, updatePeakEquity } from '../../types';
import {
  getLatestSandboxState,
  saveSandboxSnapshot,
  getPrismaClient,
} from '../../services/db';

export interface AllocationChangeInput {
  newAllocation: number;
  reason?: string;
  author?: string;
}

export interface AllocationChangeResult {
  previousAllocation: number;
  newAllocation: number;
  delta: number;
  newSandbox: SandboxContext;
  allocationRowId: string;
}

/**
 * Apply an allocation change to the wallet.
 *
 * Semantics (per user spec):
 *   - The agents are restricted to the current `allocatedCapital`.
 *   - Setting allocation from $200 → $300 ADDS $100 to cashBalance. It does NOT
 *     reset their budget. They keep whatever they spent and gain the delta.
 *   - Reducing allocation removes the delta from cashBalance, but never below 0
 *     (we don't force-close positions to honor a withdrawal).
 *
 * Persists a new SandboxState snapshot reflecting the change AND a WalletAllocation
 * audit row. Both writes happen in a single transaction so a failure leaves the
 * ledger and sandbox in lockstep.
 */
export async function applyAllocationChange(
  input: AllocationChangeInput,
  prisma: PrismaClient = getPrismaClient()
): Promise<AllocationChangeResult> {
  if (!Number.isFinite(input.newAllocation) || input.newAllocation < 0) {
    throw new Error(`Invalid allocation: ${input.newAllocation}`);
  }

  const sandbox = await getLatestSandboxState();
  const previousAllocation = sandbox?.allocatedCapital ?? 0;
  const delta = input.newAllocation - previousAllocation;

  // First-time bootstrap (no existing sandbox) — seed one.
  if (!sandbox) {
    const newSandbox: SandboxContext = {
      allocatedCapital: input.newAllocation,
      currentEquity: input.newAllocation,
      peakEquity: input.newAllocation,
      cashBalance: input.newAllocation,
      positionQty: 0,
      positionSymbol: null,
      positionAvgPrice: null,
      drawdownPct: 0,
    };
    await saveSandboxSnapshot(getTodayDate(), newSandbox);
    const row = await prisma.walletAllocation.create({
      data: {
        allocatedCapital: input.newAllocation,
        delta: input.newAllocation,
        reason: input.reason ?? 'initial allocation',
        author: input.author,
      },
    });
    return {
      previousAllocation: 0,
      newAllocation: input.newAllocation,
      delta: input.newAllocation,
      newSandbox,
      allocationRowId: row.id,
    };
  }

  if (delta === 0) {
    // No-op change — record nothing, just return current state.
    return {
      previousAllocation,
      newAllocation: input.newAllocation,
      delta: 0,
      newSandbox: sandbox,
      allocationRowId: '',
    };
  }

  const newCashBalance = sandbox.cashBalance + delta;
  if (newCashBalance < 0) {
    throw new Error(
      `Cannot reduce allocation by $${Math.abs(delta).toFixed(2)} — only $${sandbox.cashBalance.toFixed(2)} cash available. Close positions first or pick a smaller reduction.`
    );
  }

  // Adjust equity by exactly the delta (deposit/withdrawal — position value untouched).
  // Peak equity tracks "best agent performance" — it should follow capital flows so a
  // user deposit/withdrawal doesn't show up as agent profit/loss in drawdown calc.
  // Floor at 0 so a full withdrawal leaves a clean state.
  const newEquity = sandbox.currentEquity + delta;
  const newPeak = Math.max(0, sandbox.peakEquity + delta);
  const newDrawdown = calculateDrawdown(newEquity, newPeak);

  const newSandbox: SandboxContext = {
    ...sandbox,
    allocatedCapital: input.newAllocation,
    cashBalance: newCashBalance,
    currentEquity: newEquity,
    peakEquity: newPeak,
    drawdownPct: newDrawdown,
  };

  const [, allocationRow] = await prisma.$transaction([
    prisma.sandboxState.create({
      data: {
        date: getTodayDate(),
        allocatedCapital: newSandbox.allocatedCapital,
        currentEquity: newSandbox.currentEquity,
        peakEquity: newSandbox.peakEquity,
        cashBalance: newSandbox.cashBalance,
        positionQty: newSandbox.positionQty,
        positionSymbol: newSandbox.positionSymbol,
        positionAvgPrice: newSandbox.positionAvgPrice,
        drawdownPct: newSandbox.drawdownPct,
      },
    }),
    prisma.walletAllocation.create({
      data: {
        allocatedCapital: input.newAllocation,
        delta,
        reason: input.reason,
        author: input.author,
      },
    }),
  ]);

  return {
    previousAllocation,
    newAllocation: input.newAllocation,
    delta,
    newSandbox,
    allocationRowId: allocationRow.id,
  };
}

/**
 * Returns the latest WalletAllocation row, or null if the wallet has never been
 * funded. Used by the orchestrator to decide whether bootstrap is needed.
 */
export async function getCurrentAllocation(
  prisma: PrismaClient = getPrismaClient()
) {
  return prisma.walletAllocation.findFirst({ orderBy: { createdAt: 'desc' } });
}

export async function listAllocationHistory(
  prisma: PrismaClient = getPrismaClient(),
  limit = 50
) {
  return prisma.walletAllocation.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Bootstrap helper — used at the start of a cycle batch. If no allocation row
 * exists yet, create one from the env-supplied initial value. If one exists but
 * the latest sandbox snapshot disagrees with the latest allocation row (rare —
 * could happen after a manual DB edit), reconcile by applying the missing delta.
 *
 * Returns the (possibly-updated) sandbox.
 */
export async function ensureWalletInitialized(
  envInitialAllocation: number,
  prisma: PrismaClient = getPrismaClient()
): Promise<SandboxContext> {
  const allocation = await getCurrentAllocation(prisma);
  if (!allocation) {
    const result = await applyAllocationChange(
      {
        newAllocation: envInitialAllocation,
        reason: `bootstrap from ALLOCATED_CAPITAL env (=$${envInitialAllocation})`,
      },
      prisma
    );
    return result.newSandbox;
  }
  const sandbox = await getLatestSandboxState();
  if (!sandbox) {
    // Allocation row exists but no sandbox snapshot yet — synthesize one.
    const seeded: SandboxContext = {
      allocatedCapital: allocation.allocatedCapital,
      currentEquity: allocation.allocatedCapital,
      peakEquity: allocation.allocatedCapital,
      cashBalance: allocation.allocatedCapital,
      positionQty: 0,
      positionSymbol: null,
      positionAvgPrice: null,
      drawdownPct: 0,
    };
    await saveSandboxSnapshot(getTodayDate(), seeded);
    return seeded;
  }
  // If somehow the sandbox.allocatedCapital drifted from the ledger, sync up.
  if (sandbox.allocatedCapital !== allocation.allocatedCapital) {
    const result = await applyAllocationChange(
      {
        newAllocation: allocation.allocatedCapital,
        reason: 'sandbox drift reconcile (sandbox != ledger)',
      },
      prisma
    );
    return result.newSandbox;
  }
  return sandbox;
}
