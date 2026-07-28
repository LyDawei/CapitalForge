/**
 * growthScout runner — orchestrates the discovery flow:
 *
 *   1. Load current StrategyConfig.watchlist (exclude from screener).
 *   2. Run screener (quant filter to ~50 candidates).
 *   3. For each candidate, pull Finnhub fundamentals.
 *   4. Render per-candidate prompt + invoke LLM via agentRunner.
 *   5. For agent outputs with recommendForWatchlist=true, persist a
 *      WatchlistProposal row + record FeedConsumption for each contributing
 *      FeedFetch.
 *   6. Returns counts: candidates evaluated, proposals created.
 *
 * Does NOT modify the live watchlist directly — operator approves/rejects
 * through the UI.
 */
import { prisma } from '../db';
import { runAgent } from './agentRunner';
import { validateAgentOutput, outputContractFor } from '../schemas/agent-outputs';
import { runScreener } from '../services/screener';
import { getFinnhubService } from '../services/finnhub';
import { recordConsumption } from '../services/feedLog';
import { env } from '../env';

export interface ScoutResult {
  /// Total candidates screened by the quant filter.
  candidatesScreened: number;
  /// Candidates the LLM actually evaluated (some skip if data fetch fails).
  candidatesEvaluated: number;
  /// Of those, how many got recommendForWatchlist=true.
  proposalsCreated: number;
  /// Aggregate cost of the LLM calls (sums each AgentRun.costUsd).
  totalCostUsd: number;
  /// Wall-clock duration in milliseconds.
  totalLatencyMs: number;
}

export async function runGrowthScout(): Promise<ScoutResult> {
  const t0 = Date.now();

  // 1) Load scout agent + active prompt + active base prompt.
  const agent = await prisma.agent.findUnique({
    where: { name: 'growthScout' },
    include: { promptVersions: { where: { isActive: true }, take: 1 } },
  });
  const pv = agent?.promptVersions[0];
  if (!agent || !pv) {
    throw new Error('growthScout agent not seeded — run npm run prisma:seed');
  }
  const baseRow = await prisma.basePromptVersion.findFirst({ where: { isActive: true } });
  const basePrompt = baseRow ? { id: baseRow.id, template: baseRow.template } : undefined;

  // 2) Determine watchlist exclusions.
  const strategy = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } });
  const exclude = strategy?.watchlist ?? [];

  // Also exclude symbols with an open (proposed) proposal so we don't
  // generate duplicate proposals on consecutive runs. Approved/rejected
  // proposals don't exclude — operator may want a fresh thesis if conditions
  // changed since rejection.
  const openProposals = await prisma.watchlistProposal.findMany({
    where: { status: 'proposed' },
    select: { symbol: true },
  });
  const openSet = new Set(openProposals.map((p) => p.symbol));
  const fullExclude = Array.from(new Set([...exclude, ...openSet]));

  // 3) Quant screen.
  const screen = await runScreener({ excludeSymbols: fullExclude });

  // 4) Per-candidate LLM evaluation. Sequential — we don't want to hammer
  // either OpenAI or Finnhub with 50 concurrent calls, and ordering doesn't
  // matter (each candidate is independent).
  const finnhub = getFinnhubService();
  let evaluated = 0;
  let proposalsCreated = 0;
  let totalCostUsd = 0;

  for (const c of screen.candidates) {
    // Pull fundamentals — best-effort. If Finnhub returns nothing the agent
    // is instructed (via prompt) to flag thin coverage and lower confidence.
    const metricsResult = await finnhub.getCompanyMetrics(c.symbol);

    // Build the CANDIDATE block.
    const m = metricsResult.data;
    const candidateBlock =
      `--- CANDIDATE ---\n` +
      `symbol: ${c.symbol}\n` +
      `name: ${c.name ?? 'n/a'}\n` +
      `exchange: ${c.exchange ?? 'n/a'}\n` +
      `\nQuant snapshot:\n` +
      `  lastClose: $${c.lastClose.toFixed(2)}\n` +
      `  avgDollarVolume: $${(c.dollarVolume / 1_000_000).toFixed(1)}M\n` +
      `  1d return: ${(c.dailyReturn * 100).toFixed(2)}%\n` +
      `\nFundamentals (Finnhub):\n` +
      (m
        ? `  P/E (TTM): ${m.peTtm ?? 'n/a'}\n` +
          `  P/S (TTM): ${m.psTtm ?? 'n/a'}\n` +
          `  PEG (TTM): ${m.pegTtm ?? 'n/a'}\n` +
          `  Market cap: ${m.marketCapMillions != null ? `$${m.marketCapMillions.toFixed(0)}M` : 'n/a'}\n` +
          `  Revenue growth YoY: ${m.revenueGrowthQuarterlyYoy != null ? (m.revenueGrowthQuarterlyYoy * 100).toFixed(1) + '%' : 'n/a'}\n` +
          `  EPS growth YoY: ${m.epsGrowthQuarterlyYoy != null ? (m.epsGrowthQuarterlyYoy * 100).toFixed(1) + '%' : 'n/a'}\n` +
          `  Beta: ${m.beta ?? 'n/a'}\n` +
          `  52w High: $${m.weekHigh52 ?? 'n/a'}  Low: $${m.weekLow52 ?? 'n/a'}  Position: ${m.weekHighLow52Position ?? 'n/a'}\n` +
          `  Analyst Buy/Hold/Sell: ${m.analystBuy ?? 'n/a'} / ${m.analystHold ?? 'n/a'} / ${m.analystSell ?? 'n/a'}\n`
        : `  (Finnhub metrics fetch failed — agent should lower confidence and flag thin coverage)\n`);

    const renderedPrompt = `${pv.directiveTemplate}\n\n${pv.outputContract}\n\n${candidateBlock}`;

    const result = await runAgent({
      agentId: agent.id,
      promptVersionId: pv.id,
      basePrompt,
      renderedPrompt,
      inputPayload: { candidate: c, metrics: m },
      validate: (raw) => validateAgentOutput('growthScout', raw),
      runKind: 'primary',
      // Scout uses the cheaper specialist tier — 50 calls per discovery run,
      // pattern-recognition workload.
      model: env.LLM_MODEL_SPECIALIST,
    });

    evaluated++;
    totalCostUsd += result.costUsd ?? 0;

    // Record FeedConsumption for the snapshot batches + assets list + metrics
    // call so the audit UI shows "this proposal was driven by feeds X, Y, Z."
    const consumedIds = [
      ...(screen.assetsFeedFetchId ? [screen.assetsFeedFetchId] : []),
      ...screen.snapshotFeedFetchIds,
      metricsResult.feedFetchId,
    ];
    await recordConsumption({
      feedFetchIds: consumedIds,
      agentRunId: result.agentRunId,
      influenceTag: result.parsed?.recommendForWatchlist ? 'recommended' : 'rejected',
    });

    // 5) If recommended, persist proposal.
    if (result.schemaValid && result.parsed?.recommendForWatchlist === true) {
      // Mark any existing 'proposed' row for this symbol as superseded.
      const prior = await prisma.watchlistProposal.findFirst({
        where: { symbol: c.symbol, status: 'proposed' },
      });
      const created = await prisma.watchlistProposal.create({
        data: {
          symbol: c.symbol,
          status: 'proposed',
          proposedBy: 'growthScout',
          agentRunId: result.agentRunId,
          viabilityScore: result.parsed.viabilityScore,
          thesis: result.parsed.growthThesis,
          concerns: result.parsed.concerns ?? [],
          rationale: result.parsed.rationale ?? [],
          quantSnapshot: {
            lastClose: c.lastClose,
            dollarVolume: c.dollarVolume,
            dailyReturn: c.dailyReturn,
            fundamentals: m ?? null,
          } as any,
        },
      });
      if (prior) {
        await prisma.watchlistProposal.update({
          where: { id: prior.id },
          data: { status: 'superseded', supersededById: created.id },
        });
      }
      proposalsCreated++;
    }
  }

  return {
    candidatesScreened: screen.candidates.length,
    candidatesEvaluated: evaluated,
    proposalsCreated,
    totalCostUsd: +totalCostUsd.toFixed(4),
    totalLatencyMs: Date.now() - t0,
  };
}
