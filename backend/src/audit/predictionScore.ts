import { prisma } from '../db';

/**
 * Per-agent prediction quality. The headline number is hitRate: when this
 * specialist committed to a direction (|bullishScore| > 0.3), did the resulting
 * trade outcome match?
 *
 * We also surface:
 * - `recentHitRate` (last 14 days) vs `baselineHitRate` (last 30-60 days). A
 *   meaningful drop is a strong signal the prompt has stopped working.
 * - `schemaFailRate` — broken JSON output rate.
 * - `confidenceCorrelation` — does higher stated confidence predict higher
 *   hit rate? Healthy agents should score positively here.
 * - `needsReview` — boolean flag combining the above into an actionable signal.
 *
 * The Critic and the audit anomalies subsystem both consume this.
 */

export interface AgentPredictionScore {
  agentId: string;
  agentName: string;
  displayName: string;
  kind: string;
  sampleSize: number;
  hitRate: number | null;
  recentHitRate: number | null; // last 14 days
  baselineHitRate: number | null; // 14-44 days ago
  schemaFailRate: number;
  avgConfidence: number | null;
  highConfHitRate: number | null; // hit rate when confidence > 0.7
  lowConfHitRate: number | null; // hit rate when confidence <= 0.7
  needsReview: boolean;
  reviewReasons: string[];
}

const HIT_RATE_FLOOR = 0.45; // below this and we flag
const HIT_RATE_DROP_THRESHOLD = 0.12; // recent drop vs baseline that warrants review
const SCHEMA_FAIL_THRESHOLD = 0.05;
const MIN_SAMPLE_SIZE = 6; // need at least this many before flagging

export async function computePredictionScores(): Promise<AgentPredictionScore[]> {
  const agents = await prisma.agent.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  const results: AgentPredictionScore[] = [];
  for (const a of agents) {
    results.push(await computeOne(a));
  }
  return results;
}

export async function computeAgentPredictionScore(agentName: string): Promise<AgentPredictionScore | null> {
  const a = await prisma.agent.findUnique({ where: { name: agentName } });
  if (!a) return null;
  return computeOne(a);
}

async function computeOne(agent: { id: string; name: string; displayName: string; kind: string }): Promise<AgentPredictionScore> {
  // Schema failure rate — all runs
  const [allRuns, failedRuns] = await Promise.all([
    prisma.agentRun.count({ where: { agentId: agent.id } }),
    prisma.agentRun.count({ where: { agentId: agent.id, schemaValid: false } }),
  ]);
  const schemaFailRate = allRuns === 0 ? 0 : failedRuns / allRuns;

  // For specialists: pull every analysis where the cycle has a settled trade
  // For headTrader: judge by trade outcome directly
  // For riskAuditor/devilsAdvocate/critic: judge by whether their objections correlated with losses
  const samples = await loadSamples(agent.id, agent.kind, agent.name);

  if (samples.length < MIN_SAMPLE_SIZE) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      displayName: agent.displayName,
      kind: agent.kind,
      sampleSize: samples.length,
      hitRate: null,
      recentHitRate: null,
      baselineHitRate: null,
      schemaFailRate,
      avgConfidence: null,
      highConfHitRate: null,
      lowConfHitRate: null,
      needsReview: schemaFailRate > SCHEMA_FAIL_THRESHOLD,
      reviewReasons:
        schemaFailRate > SCHEMA_FAIL_THRESHOLD
          ? [`schema failure rate ${(schemaFailRate * 100).toFixed(1)}% > ${(SCHEMA_FAIL_THRESHOLD * 100).toFixed(0)}%`]
          : [],
    };
  }

  const hits = samples.filter((s) => s.correct).length;
  const hitRate = hits / samples.length;
  const avgConfidence = samples.reduce((a, b) => a + b.confidence, 0) / samples.length;

  const highConf = samples.filter((s) => s.confidence > 0.7);
  const lowConf = samples.filter((s) => s.confidence <= 0.7);
  const highConfHitRate = highConf.length > 0 ? highConf.filter((s) => s.correct).length / highConf.length : null;
  const lowConfHitRate = lowConf.length > 0 ? lowConf.filter((s) => s.correct).length / lowConf.length : null;

  // Rolling windows
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = samples.filter((s) => now - s.timestamp.getTime() < 14 * day);
  const baseline = samples.filter((s) => {
    const age = now - s.timestamp.getTime();
    return age >= 14 * day && age < 44 * day;
  });
  const recentHitRate = recent.length >= MIN_SAMPLE_SIZE ? recent.filter((s) => s.correct).length / recent.length : null;
  const baselineHitRate = baseline.length >= MIN_SAMPLE_SIZE ? baseline.filter((s) => s.correct).length / baseline.length : null;

  const reasons: string[] = [];
  if (hitRate < HIT_RATE_FLOOR) {
    reasons.push(`hit rate ${(hitRate * 100).toFixed(0)}% below ${(HIT_RATE_FLOOR * 100).toFixed(0)}% floor`);
  }
  if (recentHitRate !== null && baselineHitRate !== null && baselineHitRate - recentHitRate >= HIT_RATE_DROP_THRESHOLD) {
    reasons.push(`recent hit rate dropped ${((baselineHitRate - recentHitRate) * 100).toFixed(0)}% vs prior month`);
  }
  if (schemaFailRate > SCHEMA_FAIL_THRESHOLD) {
    reasons.push(`schema failure rate ${(schemaFailRate * 100).toFixed(1)}%`);
  }
  if (highConfHitRate !== null && lowConfHitRate !== null && highConfHitRate < lowConfHitRate) {
    reasons.push(`high-confidence picks underperform low-confidence — calibration broken`);
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    displayName: agent.displayName,
    kind: agent.kind,
    sampleSize: samples.length,
    hitRate,
    recentHitRate,
    baselineHitRate,
    schemaFailRate,
    avgConfidence,
    highConfHitRate,
    lowConfHitRate,
    needsReview: reasons.length > 0,
    reviewReasons: reasons,
  };
}

interface Sample {
  correct: boolean;
  confidence: number;
  timestamp: Date;
}

async function loadSamples(agentId: string, kind: string, agentName: string): Promise<Sample[]> {
  if (kind === 'specialist') {
    return loadSpecialistSamples(agentId);
  }
  if (kind === 'head_trader') {
    return loadHeadTraderSamples(agentId);
  }
  if (kind === 'risk_auditor' || kind === 'devils_advocate') {
    return loadAuditAgentSamples(agentId, agentName);
  }
  return [];
}

async function loadSpecialistSamples(agentId: string): Promise<Sample[]> {
  const rows = await prisma.specialistAnalysis.findMany({
    where: {
      agentRun: { agentId },
      cycle: { tradePlan: { outcome: { isNot: null } } },
    },
    select: {
      bullishScore: true,
      confidence: true,
      createdAt: true,
      cycle: {
        select: {
          tradePlan: { select: { action: true, outcome: { select: { realizedPnl: true } } } },
        },
      },
    },
  });

  return rows
    .map((r): Sample | null => {
      const pnl = r.cycle?.tradePlan?.outcome?.realizedPnl ?? null;
      const action = r.cycle?.tradePlan?.action;
      if (pnl === null || !action) return null;
      if (Math.abs(r.bullishScore) < 0.3) return null; // neutral, no commitment
      const specialistWantedUp = r.bullishScore > 0;
      const tradeWasWin = pnl > 0;
      // Specialist is "correct" if their directional view aligned with the trade's direction-adjusted outcome.
      // For a BUY trade, win = up move = matches positive score. For SELL, win = down move = matches negative score.
      const tradeDirection = action === 'BUY' ? 'long' : action === 'SELL' ? 'short' : null;
      if (!tradeDirection) return null;
      const wentInOurFavor = tradeWasWin;
      const correct =
        tradeDirection === 'long' ? specialistWantedUp === wentInOurFavor : !specialistWantedUp === wentInOurFavor;
      return { correct, confidence: r.confidence, timestamp: r.createdAt };
    })
    .filter((s): s is Sample => s !== null);
}

async function loadHeadTraderSamples(agentId: string): Promise<Sample[]> {
  const rows = await prisma.tradePlan.findMany({
    where: {
      agentRun: { agentId },
      outcome: { isNot: null },
    },
    select: {
      action: true,
      conviction: true,
      createdAt: true,
      outcome: { select: { realizedPnl: true } },
    },
  });
  return rows
    .map((r): Sample | null => {
      if (!r.outcome) return null;
      if (r.action === 'HOLD' || r.action === 'CLOSE') return null;
      const correct = r.outcome.realizedPnl > 0;
      return { correct, confidence: r.conviction, timestamp: r.createdAt };
    })
    .filter((s): s is Sample => s !== null);
}

async function loadAuditAgentSamples(agentId: string, agentName: string): Promise<Sample[]> {
  // Risk auditor / devil's advocate are "correct" when their objection (severity warn/error
  // or opposeScore > 0.6) precedes a losing trade.
  const rows = await prisma.critique.findMany({
    where: { author: agentName, tradePlan: { outcome: { isNot: null } } },
    select: {
      severity: true,
      createdAt: true,
      agentRun: { select: { parsedOutput: true } },
      tradePlan: { select: { outcome: { select: { realizedPnl: true } } } },
    },
  });
  return rows
    .map((r): Sample | null => {
      const pnl = r.tradePlan?.outcome?.realizedPnl ?? null;
      if (pnl === null) return null;
      const parsed = r.agentRun?.parsedOutput as any;
      const objected =
        r.severity === 'warn' ||
        r.severity === 'error' ||
        (parsed?.extras?.opposeScore ?? 0) > 0.6 ||
        parsed?.extras?.riskGrade === 'F';
      const tradeLost = pnl <= 0;
      const correct = objected === tradeLost;
      const confidence = parsed?.confidence ?? 0.5;
      return { correct, confidence, timestamp: r.createdAt };
    })
    .filter((s): s is Sample => s !== null);
}
