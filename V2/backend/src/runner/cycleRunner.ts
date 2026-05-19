import { prisma } from '../db';
import { getAlpacaService } from '../services/alpaca';
import { computeTechnicals, type Technicals } from './technicals';
import { runAgent, type AgentRunResult } from './agentRunner';
import { getStrategyPreset } from '../config/presets';
import { validateAgentOutput } from '../schemas/agent-outputs';

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

  // 1. Load live config — risk + strategy + active base prompt
  const [riskConfig, strategyConfig, baseRow] = await Promise.all([
    prisma.riskConfig.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.basePromptVersion.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const risk = riskConfig ?? (await prisma.riskConfig.create({ data: { reason: 'auto-created by runner' } }));
  const strategy =
    strategyConfig ?? (await prisma.strategyConfig.create({ data: { reason: 'auto-created by runner' } }));
  // basePrompt is optional — if no active row exists, runs proceed without one.
  const basePrompt = baseRow ? { id: baseRow.id, template: baseRow.template } : undefined;

  // 2. Fetch bars + compute technicals
  // Need 200+ bars so SMA200 is real, not null. Going to 220 to absorb any
  // weekend/holiday gaps the mock might introduce.
  const alpaca = getAlpacaService();
  const bars = await alpaca.getDailyBars(symbol, 220);
  const tech = computeTechnicals(symbol, bars);

  // 3. Create or upsert Cycle row
  const cycle = await prisma.cycle.upsert({
    where: { date_symbol: { date, symbol } },
    update: { status: 'running', technicals: tech as any, startedAt: new Date() },
    create: { date, symbol, status: 'running', technicals: tech as any },
  });

  try {
    // 4. Load all agent rows + their active prompt versions (cached for this cycle)
    const agents = await prisma.agent.findMany({
      where: { isActive: true },
      include: { promptVersions: { where: { isActive: true }, take: 1 } },
    });
    const agentMap = new Map(agents.map((a) => [a.name, a]));

    // 5. Run all 8 specialists in parallel
    const specialistResults = await Promise.all(
      SPECIALIST_NAMES.map((name) => runSpecialist(name, cycle.id, tech, agentMap, basePrompt)),
    );

    // Persist SpecialistAnalysis rows
    for (const sr of specialistResults) {
      if (!sr) continue;
      await prisma.specialistAnalysis.create({
        data: {
          cycleId: cycle.id,
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

    // 6. Run head trader — strategy bias injected into prompt
    const headTraderResult = await runHeadTrader(cycle.id, tech, specialistResults, agentMap, strategy, basePrompt);

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
        // Apply riskTolerancePct multiplier + hard cap from RiskConfig
        const rawRisk = (ht.riskPctOfEquity ?? risk.maxRiskPctPerTrade) * risk.riskTolerancePct;
        const riskPct = Math.min(rawRisk, risk.maxRiskPctPerTrade);
        const riskDollars = strategy.allocatedCapital * riskPct;
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

    // 7. Run audit agents (risk auditor + devil's advocate) — in parallel
    await Promise.all([
      runAuditAgent('riskAuditor', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt),
      runAuditAgent('devilsAdvocate', cycle.id, tech, headTraderResult, specialistResults, agentMap, basePrompt),
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

async function runSpecialist(
  name: string,
  cycleId: string,
  tech: Technicals,
  agentMap: Map<string, any>,
  basePrompt?: { id: string; template: string },
): Promise<SpecialistRunResult | null> {
  const agent = agentMap.get(name);
  if (!agent || !agent.promptVersions?.[0]) return null;
  const pv = agent.promptVersions[0];

  const renderedPrompt = renderTemplate(renderFullTemplate(pv), tech);

  const result = await runAgent({
    agentId: agent.id,
    promptVersionId: pv.id,
    basePrompt,
    cycleId,
    renderedPrompt,
    inputPayload: { technicals: tech },
    validate: (raw) => validateAgentOutput(name, raw),
  });

  return { ...result, agentName: name };
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
  basePrompt?: { id: string; template: string },
): Promise<AgentRunResult | null> {
  const agent = agentMap.get('headTrader');
  if (!agent || !agent.promptVersions?.[0]) return null;
  const pv = agent.promptVersions[0];

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

  const fullPrompt = `${renderFullTemplate(pv)}${strategyBlock}\n\n--- SPECIALIST OUTPUTS ---\n${specialistSummary}\n\n--- TECHNICALS ---\n${JSON.stringify(tech, null, 2)}\n\n--- SANDBOX ---\n{ "allocatedCapital": ${strategy.allocatedCapital}, "currentEquity": ${strategy.allocatedCapital}, "cashBalance": ${strategy.allocatedCapital}, "drawdownPct": 0 }`;

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
  basePrompt?: { id: string; template: string },
): Promise<AgentRunResult | null> {
  const agent = agentMap.get(name);
  if (!agent || !agent.promptVersions?.[0]) return null;
  const pv = agent.promptVersions[0];

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
