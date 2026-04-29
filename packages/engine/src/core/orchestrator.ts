import { Config } from '../config';
import { AlpacaService } from '../services/alpaca';
import { LLMService } from '../services/llm';
import {
  createDailyCycle,
  getDailyCycleByDate,
  updateCycleStatus,
  createAgentEvaluation,
  createAggregatedDecision,
  createTrade,
  updateTradeStatus,
  getLatestSandboxState,
  saveSandboxSnapshot,
  getOrCreatePromptVersion,
} from '../services/db';
import { calculateTechnicals, getMinimumBarsRequired } from './technicals';
import { checkRisk, initializeSandbox, calculateUpdatedSandbox, markToMarket } from './riskManager';
import { aggregate } from './aggregator';
import { getPromptTemplate, getNewsPromptTemplate, PROMPT_VERSIONS } from '../prompts';
import {
  TechnicalData,
  SandboxContext,
  AgentOutput,
  AgentName,
  NewsData,
  getTodayDate,
} from '../types';
import { NewsService } from '../services/news';

import * as momentumAgent from '../agents/momentum';
import * as meanReversionAgent from '../agents/meanReversion';
import * as confirmationAgent from '../agents/confirmation';
import * as newsEventsAgent from '../agents/newsEvents';

export interface CycleResult {
  cycleId: string;
  date: string;
  symbol: string;
  technicalData: TechnicalData;
  evaluations: Array<{
    agentName: AgentName;
    output: AgentOutput;
  }>;
  aggregation: {
    weightedScore: number;
    decision: 'BUY' | 'SELL' | 'HOLD';
  };
  riskResult: {
    allowed: boolean;
    reason?: string;
    quantity?: number;
  };
  trade?: {
    id: string;
    alpacaOrderId: string;
    side: 'buy' | 'sell';
    quantity: number;
    filledPrice?: number;
    status: string;
  };
  finalSandbox: SandboxContext;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Public surface that the cron-loop driver in src/index.ts depends on.
 * V1 Orchestrator and V2 OrchestratorV2 both implement this.
 */
export interface OrchestratorAPI {
  runDailyCycle(date?: string): Promise<CycleResult>;
  runDailyCyclesForSymbols(symbols: string[], date?: string): Promise<CycleResult[]>;
}

export class Orchestrator implements OrchestratorAPI {
  private config: Config;
  private alpaca: AlpacaService;
  private llm: LLMService;
  private news: NewsService | null;

  constructor(config: Config, alpaca: AlpacaService, llm: LLMService, news?: NewsService) {
    this.config = config;
    this.alpaca = alpaca;
    this.llm = llm;
    this.news = news || null;
  }

  async runDailyCycle(date?: string): Promise<CycleResult> {
    // Backward compatibility: use first symbol from config
    const symbol = this.config.tradingSymbol;
    const results = await this.runDailyCyclesForSymbols([symbol], date);
    return results[0];
  }

  /**
   * Run daily cycles for multiple symbols sequentially.
   * Uses a shared sandbox portfolio - only one position can be open at a time.
   * The sandbox is loaded once at the start and threaded through each symbol's
   * cycle so that cash balance, position state, and drawdown are always current.
   */
  async runDailyCyclesForSymbols(symbols: string[], date?: string): Promise<CycleResult[]> {
    const cycleDate = date || getTodayDate();
    const results: CycleResult[] = [];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting daily cycles for ${symbols.length} symbol(s) on ${cycleDate}`);
    console.log(`Symbols: ${symbols.join(', ')}`);
    console.log(`Note: Using shared portfolio ($${this.config.allocatedCapital} limit) - only one position allowed at a time`);
    console.log(`${'='.repeat(60)}\n`);

    // Load sandbox ONCE at the start of the day's cycles
    let sharedSandbox = await getLatestSandboxState();
    if (!sharedSandbox) {
      console.log('No existing sandbox, initializing...');
      sharedSandbox = initializeSandbox(this.config.allocatedCapital);
    }
    console.log(`Shared wallet: $${sharedSandbox.cashBalance.toFixed(2)} cash, $${sharedSandbox.currentEquity.toFixed(2)} equity`);
    if (sharedSandbox.positionQty > 0) {
      console.log(`  Existing position: ${sharedSandbox.positionQty} shares of ${sharedSandbox.positionSymbol}`);
    }

    for (const symbol of symbols) {
      try {
        const result = await this.runDailyCycleForSymbol(symbol, cycleDate, sharedSandbox);
        results.push(result);
        // Thread the updated sandbox to the next symbol
        sharedSandbox = result.finalSandbox;
      } catch (error) {
        console.error(`Cycle failed for ${symbol}:`, error);
        // Continue with next symbol even if one fails — sandbox state preserved
        results.push({
          cycleId: '',
          date: cycleDate,
          symbol,
          technicalData: {} as TechnicalData,
          evaluations: [],
          aggregation: { weightedScore: 0, decision: 'HOLD' },
          riskResult: { allowed: false, reason: `Error: ${error}` },
          finalSandbox: sharedSandbox,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private async runDailyCycleForSymbol(symbol: string, cycleDate: string, incomingSandbox: SandboxContext): Promise<CycleResult> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting daily cycle for ${symbol} on ${cycleDate}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // Check if cycle already exists for this date and symbol
      const existingCycle = await getDailyCycleByDate(cycleDate, symbol);
      if (existingCycle) {
        console.log(`Cycle already exists for ${symbol} on ${cycleDate}, skipping...`);
        throw new Error(`Cycle already exists for ${symbol} on ${cycleDate}`);
      }

      // STEP 1: FETCH daily bars from Alpaca
      console.log('Step 1: Fetching daily bars...');
      const barsNeeded = getMinimumBarsRequired();
      const bars = await this.alpaca.getDailyBars(symbol, barsNeeded);
      console.log(`  Fetched ${bars.length} bars`);

      // STEP 2: CALCULATE technical indicators
      console.log('Step 2: Calculating technical indicators...');
      const technicalData = calculateTechnicals(bars, symbol);
      console.log(`  RSI: ${technicalData.rsi.toFixed(2)}`);
      console.log(`  SMA20: ${technicalData.sma20.toFixed(2)}`);
      console.log(`  SMA50: ${technicalData.sma50.toFixed(2)}`);
      console.log(`  MACD Histogram: ${technicalData.macdHistogram.toFixed(4)}`);
      console.log(`  Close: ${technicalData.close.toFixed(2)}`);

      // STEP 3: PERSIST DailyCycle record (status: pending)
      console.log('Step 3: Creating daily cycle record...');
      const cycleId = await createDailyCycle(cycleDate, symbol, technicalData);
      console.log(`  Cycle ID: ${cycleId}`);

      // STEP 4: USE shared sandbox state (passed from parent loop)
      // Mark to market with current price (updates equity if holding a position)
      console.log('Step 4: Using shared sandbox state...');
      let sandbox = markToMarket(incomingSandbox, technicalData.close);
      console.log(`  Cash: $${sandbox.cashBalance.toFixed(2)}`);
      console.log(`  Equity: $${sandbox.currentEquity.toFixed(2)}`);
      if (sandbox.positionQty > 0) {
        console.log(`  Position: ${sandbox.positionQty} shares of ${sandbox.positionSymbol}`);
      } else {
        console.log(`  Position: None (flat)`);
      }
      console.log(`  Drawdown: ${(sandbox.drawdownPct * 100).toFixed(1)}%`);

      // STEP 4.5: FETCH NEWS DATA (if news service available)
      let newsData: NewsData | null = null;
      if (this.news) {
        console.log('Step 4.5: Fetching news data...');
        try {
          newsData = await this.news.fetchNewsData(symbol);
          console.log(`  Fetched ${newsData.articles.length} articles, ${newsData.searchResults.length} search results`);
        } catch (error) {
          console.error('  News fetch failed (continuing without news):', error);
        }
      }

      // STEP 5: RUN AGENTS (in parallel)
      console.log('Step 5: Running agents...');
      const agentPromises: Promise<{ agentName: AgentName; output: AgentOutput; rawResponse: string }>[] = [
        this.runAgent('momentum', momentumAgent, technicalData, sandbox),
        this.runAgent('meanReversion', meanReversionAgent, technicalData, sandbox),
        this.runAgent('confirmation', confirmationAgent, technicalData, sandbox),
      ];

      if (newsData) {
        agentPromises.push(this.runNewsAgent(newsData, technicalData, sandbox));
      }

      const agentResults = await Promise.all(agentPromises);

      // STEP 6 & 7: VALIDATE and PERSIST evaluations
      console.log('Step 6-7: Persisting agent evaluations...');
      const evaluations: Array<{ agentName: AgentName; output: AgentOutput }> = [];

      for (const result of agentResults) {
        // Store prompt version
        const promptTemplate = result.agentName === 'newsEvents'
          ? getNewsPromptTemplate()
          : getPromptTemplate(result.agentName);
        await getOrCreatePromptVersion(
          result.agentName,
          PROMPT_VERSIONS[result.agentName],
          promptTemplate
        );

        // Store evaluation
        await createAgentEvaluation({
          cycleId,
          agentName: result.agentName,
          promptVersion: PROMPT_VERSIONS[result.agentName],
          bullishScore: result.output.bullishScore,
          confidence: result.output.confidence,
          rationale: result.output.rationale,
          rawResponse: result.rawResponse,
        });

        evaluations.push({
          agentName: result.agentName,
          output: result.output,
        });

        console.log(
          `  ${result.agentName}: score=${result.output.bullishScore.toFixed(3)}, confidence=${result.output.confidence.toFixed(3)}`
        );
      }

      // STEP 8: AGGREGATE scores
      console.log('Step 8: Aggregating scores...');
      const aggregation = aggregate(evaluations.map((e) => e.output));
      console.log(`  Weighted score: ${aggregation.weightedScore.toFixed(3)}`);
      console.log(`  Decision: ${aggregation.decision}`);

      // STEP 9 & 10: RISK CHECK
      console.log('Step 9-10: Checking risk rules...');
      const riskResult = checkRisk(aggregation.decision, sandbox, technicalData.close, {
        positionSizePct: this.config.positionSizePct,
        maxDrawdownPct: this.config.maxDrawdownPct,
      });
      console.log(`  Allowed: ${riskResult.allowed}`);
      if (!riskResult.allowed) {
        console.log(`  Reason: ${riskResult.reason}`);
      }
      if (riskResult.quantity !== undefined) {
        console.log(`  Quantity: ${riskResult.quantity}`);
      }

      // STEP 11: PERSIST aggregated decision
      console.log('Step 11: Persisting aggregated decision...');
      await createAggregatedDecision(
        cycleId,
        aggregation.weightedScore,
        aggregation.decision,
        !riskResult.allowed,
        riskResult.reason
      );

      // --- ALL DECISIONS PERSISTED BEFORE EXECUTION ---

      let tradeResult: CycleResult['trade'] | undefined;
      let finalSandbox = sandbox;

      // STEP 12: EXECUTE trade (if allowed and not HOLD)
      if (riskResult.allowed && aggregation.decision !== 'HOLD' && riskResult.quantity) {
        console.log('Step 12: Executing trade...');
        const side = aggregation.decision === 'BUY' ? 'buy' : 'sell';

        try {
          const order = await this.alpaca.submitOrder(
            symbol,
            riskResult.quantity,
            side
          );

          const tradeId = await createTrade(
            cycleId,
            order.id,
            side,
            symbol,
            riskResult.quantity
          );

          // Update trade with fill info
          if (order.status === 'filled' && order.filledAvgPrice) {
            await updateTradeStatus(
              tradeId,
              'filled',
              order.filledAvgPrice,
              order.filledAt ? new Date(order.filledAt) : new Date()
            );
          }

          tradeResult = {
            id: tradeId,
            alpacaOrderId: order.id,
            side,
            quantity: riskResult.quantity,
            filledPrice: order.filledAvgPrice,
            status: order.status,
          };

          console.log(`  Order ID: ${order.id}`);
          console.log(`  Status: ${order.status}`);
          if (order.filledAvgPrice) {
            console.log(`  Filled at: $${order.filledAvgPrice.toFixed(2)}`);
          }

          // STEP 13: UPDATE sandbox state
          console.log('Step 13: Updating sandbox state...');
          if (order.filledAvgPrice) {
            finalSandbox = calculateUpdatedSandbox(
              sandbox,
              side,
              riskResult.quantity,
              order.filledAvgPrice,
              symbol
            );
          }
        } catch (error) {
          console.error('  Trade execution failed:', error);
          tradeResult = {
            id: '',
            alpacaOrderId: '',
            side,
            quantity: riskResult.quantity,
            status: 'failed',
          };
        }
      } else {
        console.log('Step 12: No trade to execute (HOLD or blocked by risk)');
        console.log('Step 13: Updating sandbox state (mark to market only)...');
        finalSandbox = markToMarket(sandbox, technicalData.close);
      }

      // Save sandbox snapshot (persists after each symbol so state survives crashes)
      await saveSandboxSnapshot(cycleDate, finalSandbox);
      console.log(`  Wallet: $${finalSandbox.cashBalance.toFixed(2)} cash, $${finalSandbox.currentEquity.toFixed(2)} equity`);
      console.log(`  Final drawdown: ${(finalSandbox.drawdownPct * 100).toFixed(1)}%`);

      // STEP 14: COMPLETE cycle
      console.log('Step 14: Completing cycle...');
      await updateCycleStatus(cycleId, 'completed');

      console.log(`\n${'='.repeat(60)}`);
      console.log('Cycle completed successfully');
      console.log(`${'='.repeat(60)}\n`);

      return {
        cycleId,
        date: cycleDate,
        symbol,
        technicalData,
        evaluations,
        aggregation,
        riskResult,
        trade: tradeResult,
        finalSandbox,
        status: 'completed',
      };
    } catch (error) {
      console.error('Cycle failed:', error);

      // Try to mark cycle as failed if it was created
      try {
        const cycle = await getDailyCycleByDate(cycleDate, symbol);
        if (cycle && cycle.status === 'pending') {
          await updateCycleStatus(cycle.id, 'failed');
        }
      } catch {
        // Ignore errors in cleanup
      }

      throw error;
    }
  }

  private async runAgent(
    agentName: AgentName,
    agent: typeof momentumAgent | typeof meanReversionAgent | typeof confirmationAgent,
    data: TechnicalData,
    sandbox: SandboxContext
  ): Promise<{
    agentName: AgentName;
    output: AgentOutput;
    rawResponse: string;
  }> {
    try {
      const { output, rawResponse } = await agent.evaluate(data, sandbox, this.llm);
      return { agentName, output, rawResponse };
    } catch (error) {
      console.error(`Agent ${agentName} failed:`, error);
      return {
        agentName,
        output: {
          bullishScore: 0,
          confidence: 0,
          rationale: [`Agent error: ${error}`],
        },
        rawResponse: `Error: ${error}`,
      };
    }
  }

  private async runNewsAgent(
    newsData: NewsData,
    data: TechnicalData,
    sandbox: SandboxContext
  ): Promise<{
    agentName: AgentName;
    output: AgentOutput;
    rawResponse: string;
  }> {
    try {
      const { output, rawResponse } = await newsEventsAgent.evaluate(data, sandbox, this.llm, newsData);
      return { agentName: 'newsEvents', output, rawResponse };
    } catch (error) {
      console.error('Agent newsEvents failed:', error);
      return {
        agentName: 'newsEvents',
        output: {
          bullishScore: 0,
          confidence: 0,
          rationale: [`Agent error: ${error}`],
        },
        rawResponse: `Error: ${error}`,
      };
    }
  }
}

export function createOrchestrator(
  config: Config,
  alpaca: AlpacaService,
  llm: LLMService,
  news?: NewsService
): OrchestratorAPI {
  return new Orchestrator(config, alpaca, llm, news);
}
