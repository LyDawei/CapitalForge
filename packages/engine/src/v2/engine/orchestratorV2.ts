import { Config } from '../../config';
import { AlpacaService } from '../../services/alpaca';
import { LLMService } from '../../services/llm';
import { NewsService } from '../../services/news';
import {
  CycleResult,
  OrchestratorAPI,
} from '../../core/orchestrator';
import { calculateTechnicals, getMinimumBarsRequired } from '../../core/technicals';
import { markToMarket } from '../../core/riskManager';
import { ensureWalletInitialized } from './walletAllocation';
import {
  createDailyCycle,
  getDailyCycleByDate,
  updateCycleStatus,
  createSpecialistAnalysis,
  createDeliberation,
  createToolCall,
  createTradePlan,
  saveSandboxSnapshot,
  getOrCreatePromptVersion,
} from '../../services/db';
import { getTodayDate, TechnicalData, SandboxContext } from '../../types';
import { SPECIALIST_ROSTER, runSpecialist, SpecialistRunResult } from '../specialists';
import { deliberate, HEAD_TRADER_PROMPT_VERSION } from './headTrader';
import { applySizing } from './riskManagerV2';
import { getCurrentRiskConfig, type RiskConfigValues } from './riskConfig';
import { buildHeadTraderToolRegistry } from '../tools';
import { getPrismaClient } from '../../services/db';
import {
  settleOpenPlansForSymbol,
  applyOpenToSandbox,
  discretionaryClose,
} from './tradePlanLifecycle';

/**
 * V2 orchestrator. At M2 it runs the six specialists in parallel and persists
 * SpecialistAnalysis rows. Aggregation is a placeholder (confidence-weighted
 * average → BUY/SELL/HOLD with V1 thresholds). The head trader (M3) and trade
 * execution (M3+M5+M6) replace this aggregator and add TradePlan + Deliberation.
 */
export class OrchestratorV2 implements OrchestratorAPI {
  constructor(
    private readonly config: Config,
    private readonly alpaca: AlpacaService,
    private readonly llm: LLMService,
    private readonly news: NewsService | null = null
  ) {}

  async runDailyCycle(date?: string): Promise<CycleResult> {
    const symbol = this.config.tradingSymbol;
    const results = await this.runDailyCyclesForSymbols([symbol], date);
    return results[0];
  }

  async runDailyCyclesForSymbols(symbols: string[], date?: string): Promise<CycleResult[]> {
    const cycleDate = date ?? getTodayDate();
    const results: CycleResult[] = [];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[V2] Starting daily cycles for ${symbols.length} symbol(s) on ${cycleDate}`);
    console.log(`Symbols: ${symbols.join(', ')}`);
    console.log(`${'='.repeat(60)}\n`);

    // Wallet allocation is the persistent source of truth. The env var seeds
    // the initial value; subsequent changes go through the explicit API.
    let sandbox = await ensureWalletInitialized(this.config.allocatedCapital);
    const riskConfig = await getCurrentRiskConfig();
    console.log(
      `[V2] Shared wallet: $${sandbox.cashBalance.toFixed(2)} cash, $${sandbox.currentEquity.toFixed(2)} equity (allocated $${sandbox.allocatedCapital.toFixed(2)})`
    );
    console.log(
      `[V2] Risk config: tolerance ${(riskConfig.riskTolerancePct * 100).toFixed(0)}%, max risk/trade ${(riskConfig.maxRiskPctPerTrade * 100).toFixed(2)}%, stop ${(riskConfig.defaultStopLossPct * 100).toFixed(1)}%, targets ${riskConfig.defaultTarget1R}R/${riskConfig.defaultTarget2R}R`
    );

    for (const symbol of symbols) {
      try {
        const result = await this.runCycleForSymbol(symbol, cycleDate, sandbox, riskConfig);
        results.push(result);
        sandbox = result.finalSandbox;
        await saveSandboxSnapshot(cycleDate, sandbox);
      } catch (error) {
        console.error(`[V2] Cycle failed for ${symbol}:`, error);
        results.push(failedResult(symbol, cycleDate, sandbox, error));
      }
    }
    return results;
  }

  private async runCycleForSymbol(
    symbol: string,
    cycleDate: string,
    incomingSandbox: SandboxContext,
    riskConfig: RiskConfigValues
  ): Promise<CycleResult> {
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`[V2] ${symbol} @ ${cycleDate}`);
    console.log(`${'-'.repeat(60)}`);

    const existing = await getDailyCycleByDate(cycleDate, symbol);
    if (existing) {
      throw new Error(`Cycle already exists for ${symbol} on ${cycleDate}`);
    }

    // 1. Fetch bars + technicals (reuses V1 helpers)
    const bars = await this.alpaca.getDailyBars(symbol, getMinimumBarsRequired());
    const technicalData = calculateTechnicals(bars, symbol);
    console.log(`[V2] Technicals — RSI ${technicalData.rsi.toFixed(2)}, SMA20 $${technicalData.sma20.toFixed(2)}, SMA50 $${technicalData.sma50.toFixed(2)}, MACD ${technicalData.macdHistogram.toFixed(4)}`);

    // 2. Persist DailyCycle (engineVersion='v2')
    const cycleId = await createDailyCycle(cycleDate, symbol, technicalData, 'v2');
    console.log(`[V2] Cycle ID: ${cycleId}`);

    // 3a. Lifecycle: settle any active plans for this symbol that hit stop/target/time-stop
    const prisma = getPrismaClient();
    const settlement = await settleOpenPlansForSymbol(
      symbol,
      incomingSandbox,
      cycleDate,
      this.alpaca,
      prisma,
      riskConfig.defaultTimeStopBars
    );
    let workingSandbox = settlement.sandbox;
    if (settlement.closes.length > 0) {
      for (const c of settlement.closes) {
        console.log(
          `[V2] Lifecycle close ${symbol}: ${c.closeReason} @ $${c.exitPrice.toFixed(2)} → PnL $${c.realizedPnl.toFixed(2)} (${c.rMultiple >= 0 ? '+' : ''}${c.rMultiple.toFixed(2)}R)`
        );
      }
    }

    // 3b. Mark to market with the (possibly-updated) sandbox
    const sandbox = markToMarket(workingSandbox, technicalData.close);
    console.log(`[V2] Sandbox — cash $${sandbox.cashBalance.toFixed(2)}, equity $${sandbox.currentEquity.toFixed(2)}, drawdown ${(sandbox.drawdownPct * 100).toFixed(1)}%`);

    // 4. Run six specialists in parallel
    const ctx = { symbol, technicals: technicalData, sandbox };
    console.log(`[V2] Running ${SPECIALIST_ROSTER.length} specialists in parallel...`);
    const specialistResults = await Promise.allSettled(
      SPECIALIST_ROSTER.map((specialist) => runSpecialist(specialist, ctx, this.llm))
    );

    const successful: SpecialistRunResult[] = [];
    for (let i = 0; i < specialistResults.length; i++) {
      const r = specialistResults[i];
      const specialist = SPECIALIST_ROSTER[i];
      if (r.status === 'fulfilled') {
        successful.push(r.value);
        console.log(
          `  ✓ ${specialist.name}: score ${r.value.output.bullishScore.toFixed(2)}, conf ${r.value.output.confidence.toFixed(2)}`
        );
      } else {
        console.error(`  ✗ ${specialist.name} failed: ${r.reason}`);
      }
    }

    // 5. Persist SpecialistAnalysis rows + prompt versions
    for (const result of successful) {
      const specialist = SPECIALIST_ROSTER.find((s) => s.name === result.name)!;
      const promptTemplate = specialist.buildPrompt(ctx);
      await getOrCreatePromptVersion(result.name, result.promptVersion, promptTemplate);
      await createSpecialistAnalysis({
        cycleId,
        specialistName: result.name,
        promptVersion: result.promptVersion,
        bullishScore: result.output.bullishScore,
        confidence: result.output.confidence,
        rationale: result.output.rationale,
        flags: result.output.flags,
        keyLevels: result.output.keyLevels ?? null,
        extras: (result.output.extras ?? null) as Record<string, unknown> | null,
        rawResponse: result.rawResponse,
      });
    }

    // 6. Head-trader deliberation (multi-round, tool-using at M4)
    console.log('[V2] Calling head trader…');
    let deliberation: Awaited<ReturnType<typeof deliberate>>;
    try {
      const toolRegistry = buildHeadTraderToolRegistry();
      deliberation = await deliberate(
        { symbol, technicals: technicalData, sandbox, specialists: successful, riskConfig },
        this.llm,
        this.config.llmModel,
        toolRegistry,
        {
          symbol,
          cycleDate,
          technicals: technicalData,
          sandbox,
          alpaca: this.alpaca,
          news: this.news,
          prisma,
        }
      );
    } catch (error) {
      console.error(`[V2] Head trader failed: ${error}`);
      await updateCycleStatus(cycleId, 'failed');
      throw error;
    }
    console.log(
      `[V2] Head trader → ${deliberation.plan.action} (conviction ${deliberation.plan.conviction.toFixed(2)})`
    );

    // 7. Apply deterministic risk-manager sizing + drawdown ladder
    let sized = applySizing({ plan: deliberation.plan, sandbox, config: riskConfig });

    // 7b. Single-position constraint — if we already hold something, force HOLD on a fresh BUY.
    if (sized.plan.action === 'BUY' && sandbox.positionQty > 0) {
      console.log(`[V2] Already holding ${sandbox.positionSymbol} — forcing HOLD on ${symbol} BUY`);
      sized = {
        ...sized,
        plan: {
          ...sized.plan,
          action: 'HOLD',
          stop: null,
          target1: null,
          target2: null,
          riskPctOfEquity: 0,
          timeStop: null,
          invalidationCriteria: [],
        },
        shares: 0,
        riskDollars: 0,
        modified: true,
        interventions: [...sized.interventions, 'single-position constraint: already holding another symbol'],
      };
    }

    if (sized.modified) {
      console.log(`[V2] Risk manager intervened: ${sized.interventions.join('; ')}`);
    }
    const finalPlan = sized.plan;

    // 8. Persist head-trader prompt version + Deliberation + ToolCalls + TradePlan
    await getOrCreatePromptVersion('headTrader', HEAD_TRADER_PROMPT_VERSION, deliberation.prompt);
    const deliberationId = await createDeliberation({
      cycleId,
      symbol,
      rounds: deliberation.rounds,
      finalAction: finalPlan.action,
      conviction: finalPlan.conviction,
      totalLatencyMs: deliberation.totalLatencyMs,
      totalTokens: deliberation.totalTokens,
      modelName: deliberation.modelName,
      promptVersion: deliberation.promptVersion,
      reasoningTrace: finalPlan.reasoningTrace,
    });
    for (const tc of deliberation.toolCalls) {
      await createToolCall({
        deliberationId,
        round: tc.round,
        toolName: tc.toolName,
        args: tc.args,
        result: tc.result,
        latencyMs: tc.latencyMs,
        errored: tc.errored,
        errorMessage: tc.errorMessage,
      });
    }
    // M5: BUY plans go ACTIVE (debit sandbox); CLOSE plans settle the open position;
    // HOLD/SELL plans persist as 'proposed' for audit but don't move money.
    let planStatus: 'proposed' | 'active' | 'closed' = 'proposed';
    let executedPlanId: string | null = null;
    let postExecSandbox = sandbox;

    if (finalPlan.action === 'BUY' && sized.shares > 0) {
      planStatus = 'active';
      postExecSandbox = applyOpenToSandbox(sandbox, symbol, sized.shares, finalPlan.entry);
      console.log(
        `[V2] Activating BUY: ${sized.shares} sh @ $${finalPlan.entry.toFixed(2)} → cash $${postExecSandbox.cashBalance.toFixed(2)}`
      );
    }

    executedPlanId = await createTradePlan({
      cycleId,
      symbol,
      action: finalPlan.action,
      setupName: finalPlan.setupName,
      entry: finalPlan.entry,
      stop: finalPlan.stop,
      target1: finalPlan.target1,
      target2: finalPlan.target2,
      riskPctOfEquity: finalPlan.riskPctOfEquity,
      riskDollars: sized.riskDollars,
      shares: sized.shares,
      conviction: finalPlan.conviction,
      timeStopBars: finalPlan.timeStop,
      invalidationCriteria: finalPlan.invalidationCriteria,
      status: planStatus,
    });

    // Discretionary CLOSE — head trader explicitly chose to exit a position.
    if (finalPlan.action === 'CLOSE') {
      const closeResult = await discretionaryClose(
        symbol,
        sandbox,
        technicalData.close,
        cycleDate,
        prisma
      );
      if (closeResult.close) {
        postExecSandbox = closeResult.sandbox;
        console.log(
          `[V2] Discretionary CLOSE ${symbol} @ $${technicalData.close.toFixed(2)} → PnL $${closeResult.close.realizedPnl.toFixed(2)} (${closeResult.close.rMultiple >= 0 ? '+' : ''}${closeResult.close.rMultiple.toFixed(2)}R)`
        );
      } else {
        console.log(`[V2] CLOSE requested but no active plan found for ${symbol}`);
      }
    }

    void executedPlanId;

    // 9. Mark cycle completed
    await updateCycleStatus(cycleId, 'completed');

    const aggregation = mapPlanToAggregation(finalPlan);
    const allowed = planStatus === 'active' || finalPlan.action === 'CLOSE';
    return {
      cycleId,
      date: cycleDate,
      symbol,
      technicalData,
      evaluations: [], // V1 shape — V2 specialist rows live in SpecialistAnalysis
      aggregation,
      riskResult: {
        allowed,
        reason: sized.modified
          ? sized.interventions.join('; ')
          : finalPlan.action === 'BUY'
            ? `Activated ${sized.shares} sh @ $${finalPlan.entry.toFixed(2)}`
            : finalPlan.action === 'CLOSE'
              ? `Closed at $${technicalData.close.toFixed(2)}`
              : 'No-trade decision',
        quantity: sized.shares,
      },
      finalSandbox: postExecSandbox,
      status: 'completed',
    };
  }
}

function mapPlanToAggregation(plan: { action: string; conviction: number }): {
  weightedScore: number;
  decision: 'BUY' | 'SELL' | 'HOLD';
} {
  // V1 CycleResult only knows BUY/SELL/HOLD. CLOSE collapses to SELL for log purposes.
  const decision: 'BUY' | 'SELL' | 'HOLD' =
    plan.action === 'BUY'
      ? 'BUY'
      : plan.action === 'SELL' || plan.action === 'CLOSE'
        ? 'SELL'
        : 'HOLD';
  // Use conviction as the "weighted score" magnitude with appropriate sign.
  const sign = decision === 'BUY' ? 1 : decision === 'SELL' ? -1 : 0;
  return { weightedScore: sign * plan.conviction, decision };
}

function failedResult(
  symbol: string,
  date: string,
  sandbox: SandboxContext,
  error: unknown
): CycleResult {
  return {
    cycleId: '',
    date,
    symbol,
    technicalData: {} as TechnicalData,
    evaluations: [],
    aggregation: { weightedScore: 0, decision: 'HOLD' },
    riskResult: { allowed: false, reason: `Error: ${error}` },
    finalSandbox: sandbox,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}

export function createOrchestratorV2(
  config: Config,
  alpaca: AlpacaService,
  llm: LLMService,
  news: NewsService | null = null
): OrchestratorAPI {
  return new OrchestratorV2(config, alpaca, llm, news);
}

export type { CycleResult };
