import cron from 'node-cron';
import { loadConfig, Config } from './config';
import { createAlpacaService, AlpacaService } from './services/alpaca';
import { createMockAlpacaService } from './services/alpaca.mock';
import { createLLMService, LLMService } from './services/llm';
import { createMockLLMService } from './services/llm.mock';
import { createOrchestrator, Orchestrator } from './core/orchestrator';
import { disconnectPrisma } from './services/db';
import dotenv from 'dotenv';
dotenv.config();

function createServices(config: Config): {
  alpaca: AlpacaService;
  llm: LLMService;
} {
  if (config.mode === 'mock') {
    console.log('Running in MOCK mode');
    return {
      alpaca: createMockAlpacaService(),
      llm: createMockLLMService(),
    };
  } else {
    console.log('Running in PAPER trading mode');
    return {
      alpaca: createAlpacaService(config),
      llm: createLLMService(config),
    };
  }
}

async function runCycle(orchestrator: Orchestrator, symbols: string[]): Promise<void> {
  try {
    const results = await orchestrator.runDailyCyclesForSymbols(symbols);
    
    console.log('\n' + '='.repeat(60));
    console.log('Daily Cycle Summary');
    console.log('='.repeat(60));
    
    for (const result of results) {
      console.log(`\nSymbol: ${result.symbol}`);
      console.log(`  Date: ${result.date}`);
      console.log(`  Status: ${result.status}`);
      if (result.status === 'completed') {
        console.log(`  Decision: ${result.aggregation.decision}`);
        console.log(`  Weighted Score: ${result.aggregation.weightedScore.toFixed(3)}`);
        if (result.trade) {
          console.log(`  Trade: ${result.trade.side} ${result.trade.quantity} @ $${result.trade.filledPrice?.toFixed(2) || 'pending'}`);
        } else if (!result.riskResult.allowed) {
          console.log(`  Trade blocked: ${result.riskResult.reason || 'Risk check failed'}`);
        }
      } else if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }
    
    // Show final sandbox state (from last symbol processed)
    if (results.length > 0) {
      const lastResult = results[results.length - 1];
      if (lastResult.status === 'completed') {
        console.log(`\nFinal Portfolio State:`);
        console.log(`  Equity: $${lastResult.finalSandbox.currentEquity.toFixed(2)}`);
        console.log(`  Drawdown: ${(lastResult.finalSandbox.drawdownPct * 100).toFixed(1)}%`);
        if (lastResult.finalSandbox.positionQty > 0) {
          console.log(`  Position: ${lastResult.finalSandbox.positionQty} shares of ${lastResult.finalSandbox.positionSymbol}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
  } catch (error) {
    console.error('Cycle failed:', error);
  }
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              CAPITALFORGE V1 - MVP Trading System          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Load configuration
  const config = loadConfig();
  const symbols = config.tradingSymbols;
  
  console.log('Configuration loaded:');
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Symbols: ${symbols.join(', ')} (${symbols.length} symbol(s))`);
  console.log(`  Allocated Capital: $${config.allocatedCapital}`);
  console.log(`  Position Size: ${config.positionSizePct * 100}%`);
  console.log(`  Max Drawdown: ${config.maxDrawdownPct * 100}%`);
  console.log(`  Cron Schedule: ${config.cronSchedule}`);
  console.log('');

  // Create services
  const { alpaca, llm } = createServices(config);

  // Create orchestrator
  const orchestrator = createOrchestrator(config, alpaca, llm);

  // Check if we should run immediately (for testing)
  const runNow = process.argv.includes('--run-now');

  if (runNow) {
    console.log('Running cycle immediately (--run-now flag detected)...\n');
    await runCycle(orchestrator, symbols);
    await disconnectPrisma();
    return;
  }

  // Set up cron job
  console.log(`Scheduling daily cycle with cron: ${config.cronSchedule}`);

  const task = cron.schedule(config.cronSchedule, async () => {
    console.log(`\n[${new Date().toISOString()}] Cron triggered - starting daily cycle for ${symbols.length} symbol(s)\n`);
    await runCycle(orchestrator, symbols);
  });

  console.log('Cron job scheduled. Waiting for next execution...');
  console.log('Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    task.stop();
    await disconnectPrisma();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    task.stop();
    await disconnectPrisma();
    process.exit(0);
  });
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await disconnectPrisma();
  process.exit(1);
});
