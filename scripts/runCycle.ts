/**
 * Manual trigger script for running a daily cycle
 *
 * Usage:
 *   npm run run-cycle
 *   npm run run-cycle -- --date 2024-01-15
 */

import { loadConfig, Config } from '../src/config';
import { createAlpacaService, AlpacaService } from '../src/services/alpaca';
import { createMockAlpacaService } from '../src/services/alpaca.mock';
import { createLLMService, LLMService } from '../src/services/llm';
import { createMockLLMService } from '../src/services/llm.mock';
import { createNewsService, NewsService } from '../src/services/news';
import { createMockNewsService } from '../src/services/news.mock';
import { createOrchestrator } from '../src/core/orchestrator';
import { disconnectPrisma, getPrismaClient } from '../src/services/db';
import { getTodayDate } from '../src/types';
import dotenv from 'dotenv';
dotenv.config();

function parseArgs(): { date?: string } {
  const args = process.argv.slice(2);
  const dateIndex = args.indexOf('--date');

  if (dateIndex !== -1 && args[dateIndex + 1]) {
    return { date: args[dateIndex + 1] };
  }

  return {};
}

function createServices(config: Config): {
  alpaca: AlpacaService;
  llm: LLMService;
  news: NewsService;
} {
  if (config.mode === 'mock') {
    console.log('Running in MOCK mode');
    return {
      alpaca: createMockAlpacaService(),
      llm: createMockLLMService(),
      news: createMockNewsService(),
    };
  } else {
    console.log('Running in PAPER trading mode');
    return {
      alpaca: createAlpacaService(config),
      llm: createLLMService(config),
      news: createNewsService(config),
    };
  }
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║        CAPITALFORGE - Manual Cycle Trigger                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('\n');

  const { date } = parseArgs();
  const cycleDate = date || getTodayDate();

  console.log(`Cycle Date: ${cycleDate}\n`);

  // Load configuration
  const config = loadConfig();
  const symbols = config.tradingSymbols;
  console.log('Configuration:');
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Symbols: ${symbols.join(', ')} (${symbols.length} symbol(s))`);
  console.log(`  Allocated Capital: $${config.allocatedCapital}`);
  console.log('');

  // Test database connection
  console.log('Testing database connection...');
  try {
    const prisma = getPrismaClient();
    await prisma.$connect();
    console.log('  Database connected successfully\n');
  } catch (error) {
    console.error('  Database connection failed:', error);
    process.exit(1);
  }

  // Create services
  const { alpaca, llm, news } = createServices(config);

  // Create orchestrator
  const orchestrator = createOrchestrator(config, alpaca, llm, news);

  try {
    // Run cycles for all symbols
    const results = await orchestrator.runDailyCyclesForSymbols(symbols, cycleDate);

    // Print detailed summary for each symbol
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    CYCLE SUMMARY                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('\n');

    for (const result of results) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Symbol: ${result.symbol}`);
      console.log(`${'─'.repeat(60)}\n`);

      if (result.status === 'failed') {
        console.log(`Status: FAILED`);
        if (result.error) {
          console.log(`Error: ${result.error}`);
        }
        console.log('');
        continue;
      }

      console.log('Technical Data:');
      console.log(`  Close: $${result.technicalData.close.toFixed(2)}`);
      console.log(`  RSI: ${result.technicalData.rsi.toFixed(2)}`);
      console.log(`  SMA20: $${result.technicalData.sma20.toFixed(2)}`);
      console.log(`  SMA50: $${result.technicalData.sma50.toFixed(2)}`);
      console.log(`  MACD Histogram: ${result.technicalData.macdHistogram.toFixed(4)}`);
      console.log('');

      console.log('Agent Evaluations:');
      for (const eval_ of result.evaluations) {
        console.log(`  ${eval_.agentName}:`);
        console.log(`    Score: ${eval_.output.bullishScore.toFixed(3)}`);
        console.log(`    Confidence: ${eval_.output.confidence.toFixed(3)}`);
        console.log(`    Rationale: ${eval_.output.rationale.join('; ')}`);
      }
      console.log('');

      console.log('Aggregation:');
      console.log(`  Weighted Score: ${result.aggregation.weightedScore.toFixed(3)}`);
      console.log(`  Decision: ${result.aggregation.decision}`);
      console.log('');

      console.log('Risk Check:');
      console.log(`  Allowed: ${result.riskResult.allowed}`);
      if (result.riskResult.reason) {
        console.log(`  Reason: ${result.riskResult.reason}`);
      }
      if (result.riskResult.quantity !== undefined) {
        console.log(`  Quantity: ${result.riskResult.quantity}`);
      }
      console.log('');

      if (result.trade) {
        console.log('Trade:');
        console.log(`  Side: ${result.trade.side}`);
        console.log(`  Quantity: ${result.trade.quantity}`);
        console.log(`  Status: ${result.trade.status}`);
        if (result.trade.filledPrice) {
          console.log(`  Filled Price: $${result.trade.filledPrice.toFixed(2)}`);
        }
        console.log('');
      }

      console.log(`Status: ${result.status.toUpperCase()}`);
      console.log(`Cycle ID: ${result.cycleId}`);
    }

    // Show final sandbox state (from last symbol processed)
    if (results.length > 0) {
      const lastResult = results[results.length - 1];
      if (lastResult.status === 'completed') {
        console.log(`\n${'─'.repeat(60)}`);
        console.log('Final Portfolio State:');
        console.log(`${'─'.repeat(60)}\n`);
        console.log(`  Equity: $${lastResult.finalSandbox.currentEquity.toFixed(2)}`);
        console.log(`  Cash: $${lastResult.finalSandbox.cashBalance.toFixed(2)}`);
        if (lastResult.finalSandbox.positionQty > 0) {
          console.log(`  Position: ${lastResult.finalSandbox.positionQty} shares of ${lastResult.finalSandbox.positionSymbol}`);
        } else {
          console.log(`  Position: None (flat)`);
        }
        console.log(`  Drawdown: ${(lastResult.finalSandbox.drawdownPct * 100).toFixed(1)}%`);
        console.log('');
      }
    }
  } catch (error) {
    console.error('\nCycle failed:', error);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await disconnectPrisma();
  process.exit(1);
});
