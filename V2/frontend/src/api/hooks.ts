import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface AgentRow {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  role: string;
  description: string;
  metadata: any;
  activePromptVersionId: string | null;
  isActive: boolean;
  _count?: { runs: number; promptVersions: number };
}

export interface AgentSummary {
  window: string;
  sampleSize: number;
  schemaValid: number;
  schemaFailRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
}

export interface CalibrationBucket {
  bucketStart: number;
  bucketEnd: number;
  count: number;
  meanConfidence: number;
  observedWinRate: number | null;
}
export interface Calibration {
  sampleSize: number;
  brierScore: number | null;
  buckets: CalibrationBucket[];
}

export interface AgreementMatrix {
  names: string[];
  matrix: Record<string, Record<string, { agreement: number; sampleSize: number }>>;
}

export interface CycleRow {
  id: string;
  date: string;
  symbol: string;
  status: string;
  totalLatencyMs: number | null;
  totalCostUsd: number | null;
  tradePlan: { action: string; conviction: number; status: string } | null;
  _count: { specialistAnalyses: number; anomalies: number };
}

export interface Anomaly {
  id: string;
  kind: string;
  severity: string;
  agentId: string | null;
  cycleId: string | null;
  body: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<AgentRow[]>('/api/agents') });

export const useAgent = (name: string | undefined) =>
  useQuery({ queryKey: ['agent', name], queryFn: () => api<any>(`/api/agents/${name}`), enabled: !!name });

export const useAgentSummary = (name: string | undefined, window = '30d') =>
  useQuery({
    queryKey: ['agent-summary', name, window],
    queryFn: () => api<AgentSummary>(`/api/agents/${name}/summary?window=${window}`),
    enabled: !!name,
  });

export const useAgentRuns = (name: string | undefined, limit = 50, offset = 0) =>
  useQuery({
    queryKey: ['agent-runs', name, limit, offset],
    queryFn: () => api<{ runs: any[]; total: number }>(`/api/agents/${name}/runs?limit=${limit}&offset=${offset}`),
    enabled: !!name,
  });

export const useCalibration = (name: string | undefined) =>
  useQuery({
    queryKey: ['calibration', name],
    queryFn: () => api<Calibration>(`/api/audit/calibration/${name}`),
    enabled: !!name,
  });

export const useDrift = (name: string | undefined) =>
  useQuery({
    queryKey: ['drift', name],
    queryFn: () => api<any>(`/api/audit/drift/${name}`),
    enabled: !!name,
  });

export const useInfluence = (name: string | undefined) =>
  useQuery({
    queryKey: ['influence', name],
    queryFn: () => api<any>(`/api/audit/influence/${name}`),
    enabled: !!name,
  });

export const useStability = (name: string | undefined) =>
  useQuery({
    queryKey: ['stability', name],
    queryFn: () => api<any>(`/api/audit/stability/${name}`),
    enabled: !!name,
  });

export const useAgreement = () =>
  useQuery({ queryKey: ['agreement'], queryFn: () => api<AgreementMatrix>('/api/audit/agreement') });

export const useCycles = (limit = 50) =>
  useQuery({
    queryKey: ['cycles', limit],
    queryFn: () => api<{ cycles: CycleRow[]; total: number }>(`/api/cycles?limit=${limit}`),
  });

export const useCycle = (id: string | undefined) =>
  useQuery({ queryKey: ['cycle', id], queryFn: () => api<any>(`/api/cycles/${id}`), enabled: !!id });

export interface PromptVersion {
  id: string;
  agentId: string;
  version: string;
  directiveTemplate: string;
  outputContract: string;
  changelog: string | null;
  isActive: boolean;
  isShadowCandidate: boolean;
  createdAt: string;
  agent?: { name: string; displayName: string };
}

export const usePrompts = (agentName?: string) =>
  useQuery({
    queryKey: ['prompts', agentName],
    queryFn: () => api<PromptVersion[]>(`/api/prompts${agentName ? `?agentName=${agentName}` : ''}`),
  });

export interface AbGateResult {
  name: string;
  status: 'pass' | 'fail' | 'pending' | 'not_available';
  detail: string;
}
export interface AbVersionSummary {
  promptVersionId: string;
  version: string;
  sampleSize: number;
  schemaValid: number;
  schemaFailRate: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgConfidence: number | null;
  avgBullishScore: number | null;
  actionBreakdown: Record<string, number>;
  firstRunAt: string | null;
  lastRunAt: string | null;
}
export interface AbCompare {
  agentName: string;
  agentKind: string;
  active: AbVersionSummary;
  candidate: AbVersionSummary | null;
  gates: {
    sanity: AbGateResult[];
    timeFloor: AbGateResult;
    threshold: AbGateResult;
    verdict: 'ready' | 'pending' | 'failed';
  } | null;
}

export const useAbCompare = (agentName: string | undefined) =>
  useQuery({
    queryKey: ['ab-compare', agentName],
    queryFn: () => api<AbCompare>(`/api/prompts/ab-compare/${agentName}`),
    enabled: !!agentName,
  });

export const useTrades = (limit = 50) =>
  useQuery({
    queryKey: ['trades', limit],
    queryFn: () => api<{ trades: any[]; total: number }>(`/api/trades?limit=${limit}`),
  });

export const useAnomalies = (unacked = true) =>
  useQuery({
    queryKey: ['anomalies', unacked],
    queryFn: () => api<Anomaly[]>(`/api/anomalies?acknowledged=${!unacked}`),
  });

// ---- Config ----
export interface RiskPreset {
  name: string;
  displayName: string;
  description: string;
  values: Record<string, number>;
}
export interface StrategyPreset {
  name: string;
  displayName: string;
  description: string;
  bias: string;
  promptDirective: string;
}
export interface RiskConfig {
  id: string;
  presetName: string;
  riskTolerancePct: number;
  maxRiskPctPerTrade: number;
  maxConcurrentPositions: number;
  drawdownHalveAt: number;
  drawdownCloseOnlyAt: number;
  drawdownHardHaltAt: number;
  defaultStopLossPct: number;
  defaultTarget1R: number;
  defaultTarget2R: number;
  defaultTimeStopBars: number;
  createdAt: string;
}
export interface StrategyConfig {
  id: string;
  presetName: string;
  strategyBias: string;
  holdingPeriod: string;
  avoidEarnings: boolean;
  avoidEarningsWindowDays: number;
  watchlist: string[];
  allocatedCapital: number;
  createdAt: string;
}

export const usePresets = () =>
  useQuery({
    queryKey: ['presets'],
    queryFn: () => api<{ risk: RiskPreset[]; strategy: StrategyPreset[] }>('/api/config/presets'),
    staleTime: Infinity,
  });
export const useRiskConfig = () =>
  useQuery({ queryKey: ['risk-config'], queryFn: () => api<RiskConfig>('/api/config/risk') });
export const useStrategyConfig = () =>
  useQuery({ queryKey: ['strategy-config'], queryFn: () => api<StrategyConfig>('/api/config/strategy') });

// ---- Base prompts ----
export interface BasePromptVersion {
  id: string;
  version: string;
  template: string;
  changelog: string | null;
  isActive: boolean;
  createdAt: string;
}

export const useBasePrompts = () =>
  useQuery({ queryKey: ['base-prompts'], queryFn: () => api<BasePromptVersion[]>('/api/base-prompts') });

export const useActiveBasePrompt = () =>
  useQuery({ queryKey: ['base-prompt-active'], queryFn: () => api<BasePromptVersion>('/api/base-prompts/active') });

// ---- Prediction scores ----
export interface PredictionScore {
  agentId: string;
  agentName: string;
  displayName: string;
  kind: string;
  sampleSize: number;
  hitRate: number | null;
  recentHitRate: number | null;
  baselineHitRate: number | null;
  schemaFailRate: number;
  avgConfidence: number | null;
  highConfHitRate: number | null;
  lowConfHitRate: number | null;
  needsReview: boolean;
  reviewReasons: string[];
}

export const usePredictionScores = () =>
  useQuery({
    queryKey: ['prediction-scores'],
    queryFn: () => api<PredictionScore[]>('/api/audit/prediction-scores'),
  });

export const useAgentPredictionScore = (agentName: string | undefined) =>
  useQuery({
    queryKey: ['prediction-score', agentName],
    queryFn: () => api<PredictionScore>(`/api/audit/prediction-scores/${agentName}`),
    enabled: !!agentName,
  });

// ---- Wallet ----
export type WalletTxKind = 'deposit' | 'withdrawal' | 'trade_settlement' | 'adjustment';
export interface WalletTransaction {
  id: string;
  walletId: string;
  kind: WalletTxKind;
  amount: number;
  reason: string;
  author: string;
  tradePlanId: string | null;
  createdAt: string;
}
export interface WalletSummary {
  balance: number;
  transactionCount: number;
  recentTransactions: WalletTransaction[];
}

export const useWallet = () =>
  useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSummary>('/api/wallet') });

export const useWalletTransactions = (limit = 50, offset = 0) =>
  useQuery({
    queryKey: ['wallet-transactions', limit, offset],
    queryFn: () =>
      api<{ transactions: WalletTransaction[]; total: number; limit: number; offset: number }>(
        `/api/wallet/transactions?limit=${limit}&offset=${offset}`,
      ),
  });

// ---- Feeds ----
export interface FeedFetchRow {
  id: string;
  source: string;
  symbol: string | null;
  url: string | null;
  fetchedAt: string;
  latencyMs: number;
  costUsd: number | null;
  errored: boolean;
  errorMessage: string | null;
  _count: { consumptions: number };
}
export interface FeedFetchDetail extends FeedFetchRow {
  payload: any;
  consumptions: Array<{
    id: string;
    influenceTag: string | null;
    cycleId: string | null;
    agentRun: {
      id: string;
      runKind: string;
      schemaValid: boolean;
      parsedOutput: any;
      cycleId: string | null;
      agent: { name: string; displayName: string };
    };
  }>;
}
export interface FeedSourceSummary {
  source: string;
  totalFetches: number;
  totalLatencyMs: number;
  totalCostUsd: number;
}

export const useFeeds = (params: { source?: string; symbol?: string; errored?: boolean; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.source) qs.set('source', params.source);
  if (params.symbol) qs.set('symbol', params.symbol);
  if (params.errored !== undefined) qs.set('errored', String(params.errored));
  qs.set('limit', String(params.limit ?? 50));
  qs.set('offset', String(params.offset ?? 0));
  return useQuery({
    queryKey: ['feeds', params],
    queryFn: () => api<{ fetches: FeedFetchRow[]; total: number; limit: number; offset: number }>(`/api/feeds?${qs}`),
  });
};

export const useFeedDetail = (id: string | undefined) =>
  useQuery({
    queryKey: ['feed', id],
    queryFn: () => api<FeedFetchDetail>(`/api/feeds/${id}`),
    enabled: !!id,
  });

export const useFeedSourceSummary = () =>
  useQuery({
    queryKey: ['feed-source-summary'],
    queryFn: () => api<FeedSourceSummary[]>('/api/feeds/sources/summary'),
  });

// ---- Watchlist proposals ----
export type WatchlistProposalStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';
export interface WatchlistProposal {
  id: string;
  symbol: string;
  status: WatchlistProposalStatus;
  proposedBy: string;
  agentRunId: string | null;
  viabilityScore: number | null;
  thesis: string | null;
  concerns: string[];
  rationale: string[];
  quantSnapshot: any;
  proposedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectedReason: string | null;
  supersededById: string | null;
}

export const useWatchlistProposals = (status?: WatchlistProposalStatus, limit = 100) =>
  useQuery({
    queryKey: ['watchlist-proposals', status, limit],
    queryFn: () =>
      api<{ proposals: WatchlistProposal[]; total: number; limit: number; offset: number }>(
        `/api/watchlist/proposals?${status ? `status=${status}&` : ''}limit=${limit}`,
      ),
  });
