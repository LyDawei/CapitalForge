import type { TradePlan } from '@capitalforge/shared';
import type { SandboxContext } from '@capitalforge/shared';
import { DEFAULT_RISK_CONFIG, RiskConfigValues } from './riskConfig';

export const RISK_MANAGER_V2_VERSION = 'v2.risk.0.2.0';

export interface SizedPlan {
  /** The TradePlan after the risk manager has clamped sizing and possibly forced an action change. */
  plan: TradePlan;
  /** Computed dollar risk on the trade (0 for HOLD/CLOSE/SELL). */
  riskDollars: number;
  /** Computed share count (0 for HOLD/CLOSE/SELL). */
  shares: number;
  /** True if the head trader's plan was modified by deterministic risk rules. */
  modified: boolean;
  /** Human-readable list of risk-manager interventions, if any. */
  interventions: string[];
}

export interface ApplySizingInput {
  plan: TradePlan;
  sandbox: SandboxContext;
  /** Live risk config from the DB ledger; defaults to baseline if not provided. */
  config?: RiskConfigValues;
}

/**
 * Apply deterministic risk rules to a head-trader plan.
 *
 * Order of operations:
 *   1. Drawdown ladder — may force BUY/SELL → HOLD or CLOSE.
 *   2. Risk-tolerance multiplier — scales emitted riskPct down (or up).
 *   3. Risk-pct cap — never above maxRiskPctPerTrade.
 *   4. Sizing math — shares = floor((equity * riskPct) / (entry - stop)).
 *   5. Cash-floor check — riskDollars must not exceed cash on hand for a BUY.
 */
export function applySizing({ plan, sandbox, config }: ApplySizingInput): SizedPlan {
  const c = config ?? DEFAULT_RISK_CONFIG;
  const interventions: string[] = [];
  let working: TradePlan = { ...plan };
  let modified = false;

  // 1. Drawdown ladder
  if (sandbox.drawdownPct >= c.drawdownHardHaltAt) {
    if (working.action !== 'CLOSE') {
      interventions.push(
        `drawdown ${(sandbox.drawdownPct * 100).toFixed(1)}% >= ${(c.drawdownHardHaltAt * 100).toFixed(1)}% — hard halt, forcing HOLD`
      );
      working = forceHold(working);
      modified = true;
    }
  } else if (sandbox.drawdownPct >= c.drawdownCloseOnlyAt) {
    if (working.action === 'BUY' || working.action === 'SELL') {
      interventions.push(
        `drawdown ${(sandbox.drawdownPct * 100).toFixed(1)}% >= ${(c.drawdownCloseOnlyAt * 100).toFixed(1)}% — close-only mode, forcing HOLD`
      );
      working = forceHold(working);
      modified = true;
    }
  } else if (sandbox.drawdownPct >= c.drawdownHalveAt) {
    if (working.action === 'BUY' && working.riskPctOfEquity > 0) {
      const halved = working.riskPctOfEquity / 2;
      interventions.push(
        `drawdown ${(sandbox.drawdownPct * 100).toFixed(1)}% >= ${(c.drawdownHalveAt * 100).toFixed(1)}% — halving risk to ${(halved * 100).toFixed(2)}%`
      );
      working = { ...working, riskPctOfEquity: halved };
      modified = true;
    }
  }

  // 2. Risk-tolerance multiplier (e.g. 0.7 = "use 70% of the head trader's emitted risk")
  if (c.riskTolerancePct !== 1.0 && working.action === 'BUY' && working.riskPctOfEquity > 0) {
    const scaled = working.riskPctOfEquity * c.riskTolerancePct;
    interventions.push(
      `risk-tolerance ${(c.riskTolerancePct * 100).toFixed(0)}% — scaling risk ${(working.riskPctOfEquity * 100).toFixed(2)}% → ${(scaled * 100).toFixed(2)}%`
    );
    working = { ...working, riskPctOfEquity: scaled };
    modified = true;
  }

  // 3. Risk-pct cap
  if (working.riskPctOfEquity > c.maxRiskPctPerTrade) {
    interventions.push(
      `riskPctOfEquity ${(working.riskPctOfEquity * 100).toFixed(2)}% above ${(c.maxRiskPctPerTrade * 100).toFixed(2)}% cap — clamping`
    );
    working = { ...working, riskPctOfEquity: c.maxRiskPctPerTrade };
    modified = true;
  }

  // 4. Sizing math
  let shares = 0;
  let riskDollars = 0;

  if (working.action === 'BUY') {
    if (working.stop === null || working.stop >= working.entry) {
      interventions.push('BUY without a valid stop below entry — forcing HOLD');
      working = forceHold(working);
      modified = true;
    } else {
      const riskPerShare = working.entry - working.stop;
      riskDollars = sandbox.currentEquity * working.riskPctOfEquity;
      shares = Math.floor(riskDollars / riskPerShare);
      const positionValue = shares * working.entry;

      if (positionValue > sandbox.cashBalance) {
        // Cash-floor: reduce shares to fit available cash, recompute risk.
        shares = Math.floor(sandbox.cashBalance / working.entry);
        riskDollars = shares * riskPerShare;
        interventions.push(
          `cash-floor: position value exceeded cash, reduced to ${shares} shares`
        );
        modified = true;
      }
      if (shares <= 0) {
        interventions.push('sizing produced 0 shares — forcing HOLD');
        working = forceHold(working);
        modified = true;
        shares = 0;
        riskDollars = 0;
      }
    }
  }

  return { plan: working, riskDollars, shares, modified, interventions };
}

function forceHold(plan: TradePlan): TradePlan {
  return {
    ...plan,
    action: 'HOLD',
    setupName: null,
    stop: null,
    target1: null,
    target2: null,
    riskPctOfEquity: 0,
    timeStop: null,
    invalidationCriteria: [],
  };
}
