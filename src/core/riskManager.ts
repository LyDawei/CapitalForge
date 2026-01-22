import { Config } from '../config';
import {
  Decision,
  SandboxContext,
  RiskResult,
  calculateDrawdown,
  updatePeakEquity,
} from '../types';

export interface RiskConfig {
  positionSizePct: number;
  maxDrawdownPct: number;
}

/**
 * Pure function to check risk rules
 * Returns whether the decision is allowed and calculates quantity if applicable
 */
export function checkRisk(
  decision: Decision,
  sandbox: SandboxContext,
  currentPrice: number,
  config: RiskConfig
): RiskResult {
  // Rule 1: Max 1 position - block BUY if position exists
  if (decision === 'BUY' && sandbox.positionQty > 0) {
    return { allowed: false, reason: 'Position already open' };
  }

  // Rule 2: Must have position to SELL
  if (decision === 'SELL' && sandbox.positionQty === 0) {
    return { allowed: false, reason: 'No position to sell' };
  }

  // Rule 3: Max drawdown halt (20%)
  if (sandbox.drawdownPct >= config.maxDrawdownPct) {
    return {
      allowed: false,
      reason: `Max drawdown reached (${(sandbox.drawdownPct * 100).toFixed(1)}%)`,
    };
  }

  // Rule 4: Fixed position size (20% of allocation) - RETURNS SHARE QUANTITY
  if (decision === 'BUY') {
    const positionValue = sandbox.allocatedCapital * config.positionSizePct;
    const rawQuantity = positionValue / currentPrice;
    // Round down to avoid exceeding allocation (Alpaca supports fractional shares)
    const quantity = Math.floor(rawQuantity * 1000) / 1000; // 3 decimal precision

    if (quantity <= 0) {
      return { allowed: false, reason: 'Calculated quantity is zero or negative' };
    }

    if (positionValue > sandbox.cashBalance) {
      return { allowed: false, reason: 'Insufficient cash balance' };
    }

    return { allowed: true, quantity };
  }

  // Rule 5: SELL entire position
  if (decision === 'SELL') {
    return { allowed: true, quantity: sandbox.positionQty };
  }

  // HOLD - nothing to do
  return { allowed: true };
}

/**
 * Calculate updated sandbox state after a trade
 */
export function calculateUpdatedSandbox(
  previousSandbox: SandboxContext,
  side: 'buy' | 'sell',
  quantity: number,
  filledPrice: number,
  symbol: string
): SandboxContext {
  let newCashBalance = previousSandbox.cashBalance;
  let newPositionQty = previousSandbox.positionQty;
  let newPositionSymbol: string | null = previousSandbox.positionSymbol;
  let newPositionAvgPrice: number | null = previousSandbox.positionAvgPrice;

  if (side === 'buy') {
    const cost = quantity * filledPrice;
    newCashBalance -= cost;
    newPositionQty += quantity;
    newPositionSymbol = symbol;
    // Calculate new average price (weighted average if adding to existing position)
    if (previousSandbox.positionQty > 0 && previousSandbox.positionAvgPrice) {
      const totalCost =
        previousSandbox.positionQty * previousSandbox.positionAvgPrice +
        quantity * filledPrice;
      newPositionAvgPrice = totalCost / newPositionQty;
    } else {
      newPositionAvgPrice = filledPrice;
    }
  } else if (side === 'sell') {
    const proceeds = quantity * filledPrice;
    newCashBalance += proceeds;
    newPositionQty -= quantity;

    // If position is fully closed, clear position info
    if (newPositionQty <= 0) {
      newPositionQty = 0;
      newPositionSymbol = null;
      newPositionAvgPrice = null;
    }
  }

  // Calculate current equity
  const positionValue = newPositionQty * filledPrice;
  const newCurrentEquity = newCashBalance + positionValue;

  // Update peak equity (monotonic increase)
  const newPeakEquity = updatePeakEquity(newCurrentEquity, previousSandbox.peakEquity);

  // Calculate drawdown
  const newDrawdownPct = calculateDrawdown(newCurrentEquity, newPeakEquity);

  return {
    allocatedCapital: previousSandbox.allocatedCapital,
    currentEquity: newCurrentEquity,
    peakEquity: newPeakEquity,
    cashBalance: newCashBalance,
    positionQty: newPositionQty,
    positionSymbol: newPositionSymbol,
    positionAvgPrice: newPositionAvgPrice,
    drawdownPct: newDrawdownPct,
  };
}

/**
 * Initialize a new sandbox with starting capital
 */
export function initializeSandbox(allocatedCapital: number): SandboxContext {
  return {
    allocatedCapital,
    currentEquity: allocatedCapital,
    peakEquity: allocatedCapital,
    cashBalance: allocatedCapital,
    positionQty: 0,
    positionSymbol: null,
    positionAvgPrice: null,
    drawdownPct: 0,
  };
}

/**
 * Update sandbox equity based on current market price (mark-to-market)
 */
export function markToMarket(
  sandbox: SandboxContext,
  currentPrice: number
): SandboxContext {
  if (sandbox.positionQty === 0) {
    return sandbox;
  }

  const positionValue = sandbox.positionQty * currentPrice;
  const newCurrentEquity = sandbox.cashBalance + positionValue;
  const newPeakEquity = updatePeakEquity(newCurrentEquity, sandbox.peakEquity);
  const newDrawdownPct = calculateDrawdown(newCurrentEquity, newPeakEquity);

  return {
    ...sandbox,
    currentEquity: newCurrentEquity,
    peakEquity: newPeakEquity,
    drawdownPct: newDrawdownPct,
  };
}
