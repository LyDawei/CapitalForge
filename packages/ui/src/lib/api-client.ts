const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dbReachable: boolean;
  version: string;
  uptimeSec: number;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

// ---------- Cycles ----------

export interface TechnicalData {
  symbol: string;
  date: string;
  close: number;
  rsi: number;
  sma20: number;
  sma50: number;
  macdHistogram: number;
  volume: number;
  avgVolume: number;
}

export interface CycleListItem {
  id: string;
  date: string;
  symbol: string;
  status: 'pending' | 'completed' | 'failed';
  engineVersion: 'v1' | 'v2';
  technicalData: TechnicalData;
  createdAt: string;
  decision: { weightedScore: number; decision: string } | null;
  trade: { side: string; quantity: number; status: string } | null;
  tradePlan: { action: string; conviction: number; shares: number; status: string } | null;
  deliberation: { finalAction: string; conviction: number; rounds: number } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CycleDetail extends CycleListItem {
  evaluations: Array<{
    id: string;
    agentName: string;
    bullishScore: number;
    confidence: number;
    rationale: string[];
    rawResponse: string;
    createdAt: string;
  }>;
  decision: {
    id: string;
    weightedScore: number;
    decision: string;
    riskBlocked: boolean;
    riskReason: string | null;
  } | null;
  trade: {
    id: string;
    alpacaOrderId: string;
    side: string;
    quantity: number;
    filledPrice: number | null;
    status: string;
  } | null;
  specialistAnalyses: Array<{
    id: string;
    specialistName: string;
    bullishScore: number;
    confidence: number;
    rationale: string[];
    flags: string[];
    keyLevels: { support: number | null; resistance: number | null } | null;
    extras: Record<string, unknown> | null;
    rawResponse: string;
    promptVersion: string;
    createdAt: string;
  }>;
  deliberation: {
    id: string;
    rounds: number;
    finalAction: string;
    conviction: number;
    totalLatencyMs: number;
    totalTokens: number | null;
    modelName: string;
    promptVersion: string;
    reasoningTrace: Array<{ round: number; thought: string; toolUsed: string | null }>;
    toolCalls: Array<{
      id: string;
      round: number;
      toolName: string;
      args: unknown;
      result: unknown;
      latencyMs: number;
      errored: boolean;
      errorMessage: string | null;
    }>;
  } | null;
  tradePlan: {
    id: string;
    action: string;
    setupName: string | null;
    entry: number;
    stop: number | null;
    target1: number | null;
    target2: number | null;
    riskPctOfEquity: number;
    riskDollars: number;
    shares: number;
    conviction: number;
    timeStopBars: number | null;
    invalidationCriteria: string[];
    status: string;
    closeReason: string | null;
    realizedPnl: number | null;
  } | null;
}

export interface CycleListFilters {
  page?: number;
  pageSize?: number;
  symbol?: string;
  status?: 'pending' | 'completed' | 'failed';
  engineVersion?: 'v1' | 'v2';
  from?: string;
  to?: string;
}

export function fetchCycles(filters: CycleListFilters = {}): Promise<PaginatedResponse<CycleListItem>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return request<PaginatedResponse<CycleListItem>>(`/api/cycles${qs ? `?${qs}` : ''}`);
}

export function fetchCycle(id: string): Promise<CycleDetail> {
  return request<CycleDetail>(`/api/cycles/${id}`);
}

// ---------- Portfolio ----------

export interface SandboxState {
  id: string;
  date: string;
  allocatedCapital: number;
  currentEquity: number;
  peakEquity: number;
  cashBalance: number;
  positionQty: number;
  positionSymbol: string | null;
  positionAvgPrice: number | null;
  drawdownPct: number;
  createdAt: string;
}

export function fetchPortfolioState(): Promise<SandboxState | null> {
  return request<SandboxState | null>('/api/portfolio/state');
}

export interface EquityPoint {
  date: string;
  currentEquity: number;
  peakEquity: number;
  cashBalance: number;
  positionQty: number;
  positionSymbol: string | null;
  drawdownPct: number;
}

export function fetchEquityCurve(): Promise<EquityPoint[]> {
  return request<EquityPoint[]>('/api/portfolio/equity-curve');
}

// ---------- Symbols ----------

export interface SymbolSummary {
  symbol: string;
  cycleCount: number;
  lastSeen: string;
}

export function fetchSymbols(): Promise<SymbolSummary[]> {
  return request<SymbolSummary[]>('/api/symbols');
}

export interface SymbolDetailedSummary {
  symbol: string;
  cycleCount: number;
  lastSeen: string;
  latestCycle: {
    id: string;
    date: string;
    action: string | null;
    conviction: number | null;
    status: 'pending' | 'completed' | 'failed';
    close: number;
  } | null;
  recentCloses: number[];
  outcomes: {
    settled: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalR: number;
  };
  myPosition: {
    shares: number;
    avgPrice: number | null;
    marketValue: number;
    unrealizedPnl: number | null;
  } | null;
}

export function fetchSymbolSummaries(): Promise<SymbolDetailedSummary[]> {
  return request<SymbolDetailedSummary[]>('/api/symbols/summary');
}

export interface SymbolCyclesResponse {
  symbol: string;
  data: CycleListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function fetchSymbolCycles(
  symbol: string,
  page = 1,
  pageSize = 50
): Promise<SymbolCyclesResponse> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }).toString();
  return request<SymbolCyclesResponse>(`/api/symbols/${encodeURIComponent(symbol)}/cycles?${qs}`);
}

// ---------- Agents ----------

export interface AgentMetadata {
  name: string;
  displayName: string;
  engineVersion: 'v1' | 'v2';
  kind: 'specialist' | 'agent' | 'head_trader';
  promptVersion: string;
  role: string;
  description: string;
  extras: Array<{ key: string; description: string }>;
  flags?: string[];
  inputs: string[];
  toolUsing: boolean;
}

export interface AgentSummary extends AgentMetadata {
  stats: { totalRuns: number; persistedPromptVersions: number };
}

export interface PromptVersion {
  id: string;
  agentName: string;
  version: string;
  template: string;
  createdAt: string;
}

export interface AgentDetail {
  agent: AgentMetadata;
  promptVersions: PromptVersion[];
}

export function fetchAgents(): Promise<AgentSummary[]> {
  return request<AgentSummary[]>('/api/agents');
}

export interface AgentSummaryCard extends AgentMetadata {
  stats: { totalRuns: number };
  recentScores: number[];
  lastSeen: string | null;
  lastCycleId: string | null;
  outcomes: {
    settled: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalR: number;
  };
}

export function fetchAgentSummaries(): Promise<AgentSummaryCard[]> {
  return request<AgentSummaryCard[]>('/api/agents/summary');
}

export function fetchAgent(name: string): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/agents/${encodeURIComponent(name)}`);
}

export function fetchPromptVersion(id: string): Promise<PromptVersion> {
  return request<PromptVersion>(`/api/prompts/${id}`);
}

// ---------- Performance ----------

export interface ScoreBucket {
  bucket: 'bullish' | 'bearish' | 'neutral';
  count: number;
  actions: Record<string, number>;
}

export interface AgentPerformance {
  agentName: string;
  engineVersion: 'v1' | 'v2';
  totalRuns: number;
  hasOutcomes: boolean;
  outcomes: {
    settledTradePlans: number;
    winningTradePlans: number;
    losingTradePlans: number;
    avgScoreInWinners: number | null;
    avgScoreInLosers: number | null;
    avgConfidenceInWinners: number | null;
    avgConfidenceInLosers: number | null;
  };
  scoreBuckets: ScoreBucket[];
  rMultipleByBucket: Array<{ bucket: 'bullish' | 'bearish' | 'neutral'; avgR: number; sample: number }>;
}

export function fetchAgentPerformance(name: string): Promise<AgentPerformance> {
  return request<AgentPerformance>(`/api/agents/${encodeURIComponent(name)}/performance`);
}

export interface PortfolioOutcomes {
  settled: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRPerTrade: number | null;
  totalR: number;
  totalPnl: number;
  closeReasons: Record<string, number>;
}

export function fetchPortfolioOutcomes(): Promise<PortfolioOutcomes> {
  return request<PortfolioOutcomes>('/api/portfolio/outcomes');
}

// ---------- Notes ----------

export interface AgentNote {
  id: string;
  agentName: string;
  engineVersion: 'v1' | 'v2';
  body: string;
  cycleId: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchNotes(filters: { agent?: string; engineVersion?: 'v1' | 'v2'; cycleId?: string } = {}): Promise<AgentNote[]> {
  const params = new URLSearchParams();
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.engineVersion) params.set('engineVersion', filters.engineVersion);
  if (filters.cycleId) params.set('cycleId', filters.cycleId);
  const qs = params.toString();
  return request<AgentNote[]>(`/api/notes${qs ? `?${qs}` : ''}`);
}

export async function createNote(input: {
  agentName: string;
  engineVersion: 'v1' | 'v2';
  body: string;
  cycleId?: string;
  author?: string;
}): Promise<AgentNote> {
  const res = await fetch(`${API_BASE}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as AgentNote;
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
}

export async function settlePlans(): Promise<{ scanned: number; settled: number; skipped: number; failures: unknown[] }> {
  const res = await fetch(`${API_BASE}/api/admin/settle-plans`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}

// ---------- Wallet allocation ----------

export interface WalletAllocationRecord {
  id: string;
  allocatedCapital: number;
  delta: number;
  reason: string | null;
  author: string | null;
  createdAt: string;
}

export interface WalletState {
  allocation: WalletAllocationRecord | null;
  sandbox: SandboxState | null;
  history: WalletAllocationRecord[];
}

export function fetchWallet(): Promise<WalletState> {
  return request<WalletState>('/api/wallet');
}

export interface AllocateInput {
  allocatedCapital: number;
  reason?: string;
  author?: string;
}

export interface AllocateResult {
  previousAllocation: number;
  newAllocation: number;
  delta: number;
  newSandbox: SandboxState;
  allocationRowId: string;
}

// ---------- Risk config ----------

export interface RiskConfigValues {
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
}

export interface RiskConfigRecord extends RiskConfigValues {
  id: string;
  reason: string | null;
  author: string | null;
  createdAt: string;
}

export interface RiskConfigState {
  current: RiskConfigValues;
  defaults: RiskConfigValues;
  history: RiskConfigRecord[];
}

export function fetchRiskConfig(): Promise<RiskConfigState> {
  return request<RiskConfigState>('/api/risk-config');
}

export async function updateRiskConfig(
  input: Partial<RiskConfigValues> & { reason?: string; author?: string }
): Promise<RiskConfigValues & { id: string }> {
  const res = await fetch(`${API_BASE}/api/risk-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      (errBody as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (await res.json()) as RiskConfigValues & { id: string };
}

export async function updateAllocation(input: AllocateInput): Promise<AllocateResult> {
  const res = await fetch(`${API_BASE}/api/wallet/allocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      (errBody as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (await res.json()) as AllocateResult;
}
