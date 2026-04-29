/**
 * Public library surface of @capitalforge/engine — what other packages (api, scripts)
 * are allowed to import. Keep this lean: nothing in here should pull in the cron loop.
 */

export { settleProposedPlans } from './v2/engine/settlePlans';
export type { SettleResult } from './v2/engine/settlePlans';
export {
  applyAllocationChange,
  getCurrentAllocation,
  listAllocationHistory,
  ensureWalletInitialized,
} from './v2/engine/walletAllocation';
export type {
  AllocationChangeInput,
  AllocationChangeResult,
} from './v2/engine/walletAllocation';
export {
  getCurrentRiskConfig,
  listRiskConfigHistory,
  updateRiskConfig,
  DEFAULT_RISK_CONFIG,
} from './v2/engine/riskConfig';
export type {
  RiskConfigValues,
  RiskConfigUpdateInput,
} from './v2/engine/riskConfig';
export {
  settleOpenPlansForSymbol,
  discretionaryClose,
  detectExit,
} from './v2/engine/tradePlanLifecycle';
export type { CloseEvent, CloseReason } from './v2/engine/tradePlanLifecycle';
export { createAlpacaService } from './services/alpaca';
export { createMockAlpacaService } from './services/alpaca.mock';
export { loadConfig, getConfig, type Config } from './config';
export { getLatestSandboxState } from './services/db';
