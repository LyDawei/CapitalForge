import { PrismaClient } from '@prisma/client';
import { AlpacaService } from '../../services/alpaca';
export interface SettleResult {
    scanned: number;
    settled: number;
    skipped: number;
    failures: Array<{
        tradePlanId: string;
        reason: string;
    }>;
}
/**
 * Walk every TradePlan with status='proposed' and action='BUY' forward through subsequent
 * daily bars, deterministically detecting:
 *   - target1 hit (intra-bar high >= target1) → win
 *   - stop hit (intra-bar low <= stop)        → loss
 *   - time stop reached                        → close at the time-stop bar's close
 *
 * Updates the row in place: status='closed', closeReason, realizedPnl, closedAt.
 *
 * NOT a real-money executor — this is a counterfactual settler used to attribute outcomes
 * to specialist scores until the M5 lifecycle replaces it with live execution.
 *
 * If both stop and target are hit on the same bar, conservatively assume stop hit first
 * (path-dependent, worst-case-for-trader). This bias is documented and reproducible.
 */
export declare function settleProposedPlans(prisma: PrismaClient, alpaca: AlpacaService, options?: {
    minDaysOld?: number;
    maxToSettle?: number;
}): Promise<SettleResult>;
//# sourceMappingURL=settlePlans.d.ts.map