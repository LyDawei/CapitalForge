import { prisma } from '../db';
import { getAlpacaService } from '../services/alpaca';
import { computeTechnicals, type Technicals } from './technicals';
import { runAgent, type AgentRunResult } from './agentRunner';
import { getStrategyPreset } from '../config/presets';
import { validateAgentOutput } from '../schemas/agent-outputs';
import { getBalance as getWalletBalance } from '../services/wallet';
import { settleProposedPlans } from './settler';
import {
  fetchNewsEventsBundle,
  fetchMacroContextBundle,
  fetchLiquidityBundle,
  type FeedBundle,
} from './agentFeeds';
import { recordConsumption } from '../services/feedLog';
import { env } from '../env';

// ---------------------------------------------------------------------------
// Specialist names — must match what's seeded in the Agent table.
// ---------------------------------------------------------------------------
const SPECIALIST_NAMES = [
  'trendRegime',
  'setupPattern',
  'momentum',
  'meanReversion',
  'volumeFlow',
  'newsEvents',
  'macroContext',
  'liquiditySlippage',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CycleResult {
  cycleId: string;
  symbol: string;
  date: string;
  status: 'completed' | 'failed';
  specialistCount: number;
  action: string | null;
  conviction: number | null;
  totalLatencyMs: number;
  totalCostUsd: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main entry: run one cycle for one (date, symbol) pair.
// ---------------------------------------------------------------------------
export async function runCycle(symbol: string, date: string): Promise<CycleResult> {
  const cycleStart = Date.now();

  // 0. Settle any plans whose stop/target/time-stop has hit since the last
  //    cycle. Runs BEFORE we read the wallet balance for sizing so realized
  //    P&L flows into capital first, and BEFORE we generate today's plan so
  //    the critic has fired on the prior plan's outcome before we ask the
  //    head trader to think about the next one. Best-effort: a settler
  //    failure logs and continues; the cycle isn't blocked by an audit-only
  //    side effect.
  try {
    const settled = await settleProposedPlans();
    if (settled > 0) {
      // eslint-disable-next-line no-console
      console.log(`[cycle ${symbol}@${date}] settled ${settled} prior plan(s)`);
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(`[cycle ${symbol}@${date}] pre-cycle settler failed: ${err.message}`);
  }

  // 1. Load live config — risk + strategy + active base prompt + wallet balance.
  //    The wallet is the single source of truth for available capital;
  //    strategy.allocatedCapital is no longer read for sizing (it stays in
  //    the schema as a legacy field for any tooling that still references it).
  const [riskConfig, strategyConfig, baseRow, walletBalance] = await Promise.all([
    prisma.riskConfig.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.basePromptVersion.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }),
    getWalletBalance(),
  ]);
  const risk = riskConfig ?? (await prisma.riskConfig.create({ data: { reason: 'auto-created by runner' } }));
  const strategy =
    strategyConfig ?? (await prisma.strategyConfig.create({ data: { reason: 'auto-created by runner' } }));
  // basePrompt is optional — if no active row exists, runs proceed without one.
  const basePrompt = baseRow ? { id: baseRow.id, template: baseRow.template } : undefined;

  // 2. Fetch bars + compute technicals
  // Need 200+ bars so SMA200 is real, not null. Going to 220 to absorb any
  // weekend/holiday gaps. CRITICAL for backfill: use `date` as the anchor so
  // a historical cycle dated 2026-01-15 sees the 220 bars ending on
  // 2026-01-15, not the 220 most-recent bars from today. When `date` is
  // today/future the behavior is equivalent to getDailyBars.
  const alpaca = getAlpacaService();
  const bars = await alpaca.getDailyBarsBefore(symbol, date, 220);
  const tech = computeTechnicals(symbol, bars);

  // 3. Create or upsert Cycle row
  const cycle = await prisma.cycle.upsert({
    where: { date_symbol: { date, symbol } },
    update: { status: 'running', technicals: tech as any, startedAt: new Date() },
    create: { date, symbol, status: 'running', technicals: tech as any },
  });

  try {
    // 4. Load all agent rows + their active prompt versions, plus any
    //    shadow A/B candidates. Shadow candidates are run alongside the
    //    primary but their outputs do NOT feed downstream (head trader still
    //    only sees primary specialist outputs).
    const agents = await prisma.agent.findMany({
      where: { isActive: true },
      include: {
        promptVersions: {
          where: { OR: [{ isActive: true }, { isShadowCandidate: true }] },
        },
      },
    });
    const agentMap = new Map(agents.map((a) => [a.name, a]));

    // 5a. Pre-fetch external feeds for agents that need them. Done once per
    //     cycle (not once per variant) so primary + shadow A/B both consume
    //     the same FeedFetch rows — that's the whole point of A/B: only the
    //     prompt varies, the data doesn't.
    const feedsByAgent: Map<string, FeedBundle> = new Map();
    const [newsBundle, macroBundle, liquidityBundle] = await Promise.all([
      fetchNewsEventsBundle(symbol).catch((err: any) => {
        // eslint-disable-next-line no-console
        console.warn(`[cycle ${symbol}@${date}] newsEvents feeds failed: ${err.message}`);
        return { contextBlock: '', feedFetchIds: [] };
      }),
      fetchMacroContextBundle().catch((err: any) => {
        // eslint-disable-next-line no-console
        console.warn(`[cycle ${symbol}@${date}] macroContext feeds failed: ${err.message}`);
        return { contextBlock: '', feedFetchIds: [] };
      }),
      fetchLiquidityBundle(symbol).catch((err: any) => {
        // eslint-disable-next-line no-console
        console.warn(`[cycle ${symbol}@${date}] liquiditySlippage feeds failed: ${err.message}`);
        return { contextBlock: '', feedFetchIds: [] };
      }),
    ]);
    feedsByAgent.set('newsEvents', newsBundle);
    feedsByAgent.set('macroContext', macroBundle);
    feedsByAgent.set('liquiditySlippage', liquidityBundle);

    // 5. Run all 8 specialists in parallel — primary chain feeds downstream.
    const specialistResults = await Promise.all(
      SPECIALIST_NAMES.map((name) =>
        runSpecialist(name, cycle.id, tech, agentMap, basePrompt, 'primary', feedsByAgent.get(name)),
      ),
    );

    // 5b. Persist primary SpecialistAnalysis rows.
    for (const sr of specialistResults) {
      if (!sr) continue;
      await persistSpecialistAnalysis(cycle.id, sr);
    }

    // 5c. Shadow specialist runs — fire-and-forget, persisted with runKind='ab'.
    //     These don't feed the head trader; they exist purely for A/B audit.
    await Promise.all(
      SPECIALIST_NAMES.map(async (name) => {
        const sr = await runSpecialist(name, cycle.id, tech, agentMap, basePrompt, 'ab', feedsByAgent.get(name));
        if (sr) await persistSpecialistAnalysis(cycle.id, sr);
      }),
    );

    // 6. Run head trader — strategy bias injected into prompt. Shadow head
    //    trader (if any) runs in parallel; it gets the SAME primary specialist
    //    inputs so the only variable being tested is the head trader prompt
    //    itself. Shadow run is persisted only as an AgentRun — no Deliberation
    //    or TradePlan (cycleId is @unique on both; full TradePlan-level
    //    settlement for shadow head trader is a follow-up).
    const headTraderResult = await runHeadTrader(cycle.id, tech, specialistResults, agentMap, strategy, walletBalance, basePrompt, 'primary');
    await runHeadTrader(cycle.id, tech, specialistResults, agentMap, strategy, walletBalance, basePrompt, 'ab');

    // 6. Persist Deliberation + TradePlan
    let action: string | null = null;
    let conviction: number | null = null;

    if (headTraderResult?.parsed) {
      const ht = headTraderResult.parsed;
      action = ht.action ?? 'HOLD';
      conviction = ht.conviction ?? 0;

      await prisma.deliberation.create({
        data: {
          cycleId: cycle.id,
          rounds: (ht.reasoningTrace ?? []).length || 1,
          finalAction: action as any,
          conviction: conviction ?? 0,
          totalLatencyMs: headTraderResult.latencyMs,
          totalTokens: null,
          totalCostUsd: null,
          modelName: 'mock-smart-1',
          reasoningTrace: ht.reasoningTrace ?? [],
        },
      });

      if (action !== 'HOLD') {
        const entry = ht.entry ?? tech.close;
        // Default stop from RiskConfig if head trader didn't provide one.
        const dir = action === 'SELL' ? -1 : 1;
        const stop = ht.stop ?? +(entry - dir * entry * risk.defaultStopLossPct).toFixed(2);
        // Apply riskTolerancePct multiplier + hard cap from RiskConfig.
        // Risk dollars are sized against the wallet balance — NOT the legacy
        // strategy.allocatedCapital, which is no longer the source of truth.
        const rawRisk = (ht.riskPctOfEquity ?? risk.maxRiskPctPerTrade) * risk.riskTolerancePct;
        const riskPct = Math.min(rawRisk, risk.maxRiskPctPerTrade);
        const riskDollars = walletBalance * riskPct;
        const shares = stop > 0 ? Math.floor(riskDollars / Math.abs(entry - stop)) : 0;

        // Default targets from RiskConfig if head trader didn't provide them.
        const stopDist = Math.abs(entry - stop);
        const target1 = ht.target1 ?? +(entry + dir * stopDist * risk.defaultTarget1R).toFixed(2);
        const target2 = ht.target2 ?? +(entry + dir * stopDist * risk.defaultTarget2R).toFixed(2);

        // Holding period preference influences timeStopBars
        const timeStopFromPreference =
          strategy.holdingPeriod === 'short_term' ? 4 :
          strategy.holdingPeriod === 'long_term' ? 20 :
          risk.defaultTimeStopBars;

        await prisma.tradePlan.create({
          data: {
            cycleId: cycle.id,
            agentRunId: headTraderResult.agentRunId,
            symbol,
            action: action as any,
            setupName: ht.setupName ?? null,
            entry,
            stop,
            target1,
            target2,
            riskPctOfEquity: riskPct,
            riskDollars,
            shares,
            conviction: conviction ?? 0,
            timeStopBars: ht.timeStopBars ?? timeStopFromPreference,
            invalidationCriteria: ht.invalidationCriteria ?? [],
            status: 'proposed',
          },
        });
      }
    }

    // 7. Run audit agents (risk auditor + devil's advocate) — in parallel.
    //    Shadow audit agents run alongside primary; both persist Critiques
    //    (Critique has no cycleId uniqueness constraint, only agentRunId).
    await Promise.all([
      runAuditAgent('riskAuditor', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt, 'primary'),
      runAuditAgent('devilsAdvocate', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt, 'primary'),
      runAuditAgent('riskAuditor', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt, 'ab'),
      runAuditAgent('devilsAdvocate', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt, 'ab'),
    ]);

    // 8. Mark cycle complete
    const totalLatencyMs = Date.now() - cycleStart;
    const totalCostUsd = await sumCycleCost(cycle.id);

    await prisma.cycle.update({
      where: { id: cycle.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        totalLatencyMs,
        totalCostUsd,
      },
    });

    return {
      cycleId: cycle.id,
      symbol,
      date,
      status: 'completed',
      specialistCount: specialistResults.filter(Boolean).length,
      action,
      conviction,
      totalLatencyMs,
      totalCostUsd,
    };
  } catch (err: any) {
    await prisma.cycle.update({
      where: { id: cycle.id },
      data: { status: 'failed', completedAt: new Date(), totalLatencyMs: Date.now() - cycleStart },
    });
    return {
      cycleId: cycle.id,
      symbol,
      date,
      status: 'failed',
      specialistCount: 0,
      action: null,
      conviction: null,
      totalLatencyMs: Date.now() - cycleStart,
      totalCostUsd: 0,
      error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Run one specialist
// ---------------------------------------------------------------------------
interface SpecialistRunResult extends AgentRunResult {
  agentName: string;
}

/**
 * Picks the prompt version for the requested variant. Returns null if no
 * matching version exists — e.g., the variant='ab' lookup returns null when
 * the agent has no shadow candidate, in which case the caller should skip.
 */
function pickPromptVersion(agent: any, variant: 'primary' | 'ab'): any | null {
  if (variant === 'primary') return agent?.promptVersions?.find((p: any) => p.isActive) ?? null;
  // Shadow candidate is the one flagged but NOT also active (defense against
  // someone marking the active version as a candidate, which is a no-op).
  return agent?.promptVersions?.find((p: any) => p.isShadowCandidate && !p.isActive) ?? null;
}

async function runSpecialist(
  name: string,
  cycleId: string,
  tech: Technicals,
  agentMap: Map<string, any>,
  basePrompt: { id: string; template: string } | undefined,
  variant: 'primary' | 'ab',
  feeds?: FeedBundle,
): Promise<SpecialistRunResult | null> {
  const agent = agentMap.get(name);
  const pv = pickPromptVersion(agent, variant);
  if (!agent || !pv) return null;

  const renderedPrompt =
    renderTemplate(renderFullTemplate(pv), tech) +
    (feeds && feeds.contextBlock ? `\n\n${feeds.contextBlock}` : '');

  const result = await runAgent({
    agentId: agent.id,
    promptVersionId: pv.id,
    basePrompt,
    cycleId,
    renderedPrompt,
    inputPayload: { technicals: tech, feedFetchIds: feeds?.feedFetchIds ?? [] },
    validate: (raw) => validateAgentOutput(name, raw),
    runKind: variant,
    // Specialists + audit agents use the cheaper tier (env.LLM_MODEL_SPECIALIST,
    // default gpt-4o-mini). Head trader is sized separately below.
    model: env.LLM_MODEL_SPECIALIST,
  });

  // Audit trail: record that this agent run consumed each feed pull. The
  // influenceTag is left null at this stage — a future iteration can derive
  // it from the agent's parsed output (e.g., set 'forced_hold' when
  // newsEvents emitted forcedHoldRecommended=true).
  if (feeds && feeds.feedFetchIds.length > 0) {
    await recordConsumption({
      feedFetchIds: feeds.feedFetchIds,
      agentRunId: result.agentRunId,
      cycleId,
      influenceTag: inferInfluenceTag(name, result.parsed),
    });
  }

  return { ...result, agentName: name };
}

/**
 * Best-effort agent-self-reported influence tag, derived from the parsed
 * output. Kept conservative: if we can't read a clear signal, leave null
 * (which the UI renders as "consumed, impact unknown").
 */
function inferInfluenceTag(agentName: string, parsed: any): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  if (agentName === 'newsEvents') {
    if (parsed.extras?.forcedHoldRecommended === true) return 'forced_hold';
    if (parsed.extras?.catalystImminent === true) return 'catalyst_imminent';
    if ((parsed.confidence ?? 0) <= 0.25) return 'no_signal';
    return 'sentiment_only';
  }
  if (agentName === 'macroContext') {
    const headwind = parsed.extras?.macroHeadwindScore ?? 0;
    const tailwind = parsed.extras?.macroTailwindScore ?? 0;
    if (headwind > 0.6) return 'headwind';
    if (tailwind > 0.6) return 'tailwind';
    if ((parsed.confidence ?? 0) <= 0.25) return 'no_signal';
    return 'neutral';
  }
  if (agentName === 'liquiditySlippage') {
    if (parsed.extras?.tradable === false) return 'not_tradable';
    const slippage = parsed.extras?.estimatedSlippageBps ?? 0;
    if (slippage > 50) return 'wide_spread';
    const risk = parsed.extras?.executionRisk;
    if (risk === 'high' || risk === 'extreme') return 'thin_book';
    return 'liquid';
  }
  return undefined;
}

async function persistSpecialistAnalysis(cycleId: string, sr: SpecialistRunResult) {
  await prisma.specialistAnalysis.create({
    data: {
      cycleId,
      agentRunId: sr.agentRunId,
      agentName: sr.agentName,
      bullishScore: sr.parsed?.bullishScore ?? 0,
      confidence: sr.parsed?.confidence ?? 0,
      rationale: sr.parsed?.rationale ?? [],
      flags: sr.parsed?.flags ?? [],
      keyLevels: sr.parsed?.keyLevels ?? null,
      extras: sr.parsed?.extras ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Run head trader
// ---------------------------------------------------------------------------
async function runHeadTrader(
  cycleId: string,
  tech: Technicals,
  specialistResults: (SpecialistRunResult | null)[],
  agentMap: Map<string, any>,
  strategy: { strategyBias: string; holdingPeriod: string; avoidEarnings: boolean; avoidEarningsWindowDays: number; allocatedCapital: number },
  walletBalance: number,
  basePrompt: { id: string; template: string } | undefined,
  variant: 'primary' | 'ab',
): Promise<AgentRunResult | null> {
  const agent = agentMap.get('headTrader');
  const pv = pickPromptVersion(agent, variant);
  if (!agent || !pv) return null;

  // Build specialist summary block
  const specialistSummary = specialistResults
    .filter(Boolean)
    .map((sr) => {
      const p = sr!.parsed ?? {};
      return `[${sr!.agentName}] score=${p.bullishScore ?? '?'} conf=${p.confidence ?? '?'} flags=[${(p.flags ?? []).join(',')}]`;
    })
    .join('\n');

  // Inject strategy bias directive
  const biasPreset = getStrategyPreset(strategy.strategyBias);
  const strategyBlock = biasPreset
    ? `\n--- STRATEGY DIRECTIVE ---\n${biasPreset.promptDirective}\nHolding period preference: ${strategy.holdingPeriod}.${strategy.avoidEarnings ? ` Force HOLD if earnings within ${strategy.avoidEarningsWindowDays} days.` : ''}`
    : '';

  // SANDBOX block is the head trader's sizing context. Wallet balance is the
  // single source of truth — operators deposit/withdraw via the wallet ledger,
  // and the settler auto-books trade outcomes back into it.
  const fullPrompt = `${renderFullTemplate(pv)}${strategyBlock}\n\n--- SPECIALIST OUTPUTS ---\n${specialistSummary}\n\n--- TECHNICALS ---\n${JSON.stringify(tech, null, 2)}\n\n--- SANDBOX ---\n{ "walletBalance": ${walletBalance}, "currentEquity": ${walletBalance}, "cashBalance": ${walletBalance}, "drawdownPct": 0 }`;

  return runAgent({
    agentId: agent.id,
    promptVersionId: pv.id,
    basePrompt,
    cycleId,
    renderedPrompt: fullPrompt,
    inputPayload: {
      technicals: tech,
      specialists: specialistResults.filter(Boolean).map((s) => ({ name: s!.agentName, parsed: s!.parsed })),
    },
    validate: (raw) => validateAgentOutput('headTrader', raw),
    runKind: variant,
    // Head trader gets the premium tier (env.LLM_MODEL, default gpt-4o).
    // This is the synthesis step where the cost premium pays off.
    model: env.LLM_MODEL,
  });
}

// ---------------------------------------------------------------------------
// Run audit agent (riskAuditor or devilsAdvocate)
// ---------------------------------------------------------------------------
async function runAuditAgent(
  name: string,
  cycleId: string,
  tech: Technicals,
  headTraderResult: AgentRunResult | null,
  specialistResults: (SpecialistRunResult | null)[],
  agentMap: Map<string, any>,
  basePrompt: { id: string; template: string } | undefined,
  variant: 'primary' | 'ab',
): Promise<AgentRunResult | null> {
  const agent = agentMap.get(name);
  const pv = pickPromptVersion(agent, variant);
  if (!agent || !pv) return null;

  const htSummary = headTraderResult?.parsed
    ? JSON.stringify(headTraderResult.parsed, null, 2)
    : '(no head trader output)';

  const fullPrompt = `${renderFullTemplate(pv)}\n\n--- HEAD TRADER PLAN ---\n${htSummary}\n\n--- TECHNICALS ---\n${JSON.stringify(tech, null, 2)}`;

  const result = await runAgent({
    agentId: agent.id,
    promptVersionId: pv.id,
    basePrompt,
    cycleId,
    renderedPrompt: fullPrompt,
    inputPayload: { headTraderPlan: headTraderResult?.parsed, technicals: tech },
    validate: (raw) => validateAgentOutput(name, raw),
    runKind: variant,
    // Audit agents use the cheaper specialist tier — they're pattern checkers,
    // not synthesizers.
    model: env.LLM_MODEL_SPECIALIST,
  });

  // If this is a riskAuditor or devilsAdvocate with extras, persist as Critique
  if (result.parsed && (name === 'riskAuditor' || name === 'devilsAdvocate')) {
    const extras = result.parsed.extras ?? {};
    const severity =
      name === 'riskAuditor'
        ? extras.riskGrade === 'F' ? 'error' : extras.riskGrade === 'C' ? 'warn' : 'info'
        : (extras.opposeScore ?? 0) > 0.7 ? 'warn' : 'info';

    const body = (result.parsed.rationale ?? []).join(' ') + (extras.objections ? ' Objections: ' + extras.objections.join('; ') : '');

    // Find the trade plan for this cycle (if any)
    const tradePlan = await prisma.tradePlan.findUnique({ where: { cycleId } });

    await prisma.critique.create({
      data: {
        cycleId,
        agentRunId: result.agentRunId,
        tradePlanId: tradePlan?.id ?? null,
        author: name,
        severity: severity as any,
        body: body || `${name} review completed.`,
        tags: result.parsed.flags ?? [],
      },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Re-assembles a prompt version into the literal text sent to the LLM. */
function renderFullTemplate(pv: { directiveTemplate: string; outputContract: string }): string {
  return pv.outputContract
    ? `${pv.directiveTemplate}\n\n${pv.outputContract}`
    : pv.directiveTemplate;
}

function renderTemplate(template: string, tech: Technicals): string {
  const sma200Line = tech.sma200 !== null ? `$${tech.sma200.toFixed(2)}` : 'INSUFFICIENT_HISTORY';
  return `${template}\n\n--- TECHNICALS ---\nSymbol: ${tech.symbol}\nDate: ${tech.date}\nClose: $${tech.close.toFixed(2)}\nRSI(14): ${tech.rsi.toFixed(2)}\nSMA(20): $${tech.sma20.toFixed(2)}\nSMA(50): $${tech.sma50.toFixed(2)}\nSMA(200): ${sma200Line}\nMACD Histogram: ${tech.macdHistogram.toFixed(4)}\nATR(14): $${tech.atr14.toFixed(2)} (${(tech.atrPct * 100).toFixed(2)}% of close)\nVolume: ${tech.volume.toLocaleString()} (30d avg: ${tech.avgVolume.toLocaleString()})`;
}

async function sumCycleCost(cycleId: string): Promise<number> {
  const agg = await prisma.agentRun.aggregate({
    where: { cycleId },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ?? 0;
}
