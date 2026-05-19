/**
 * Seed data generator: runs many cycles across symbols and dates so the UI
 * has rich, varied data to display. Also settles the proposed trades.
 *
 * Usage:
 *   npx tsx scripts/seed-cycles.ts
 *   npx tsx scripts/seed-cycles.ts --count 30
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SYMBOLS = ['SPY', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'];

async function main() {
  const countArg = process.argv.indexOf('--count');
  const count = countArg >= 0 ? parseInt(process.argv[countArg + 1] ?? '20', 10) : 20;

  const { runCycle, settleProposedPlans } = await import('../backend/src/runner');

  // Generate `count` trading days going backwards from today
  const dates = generateTradingDates(count);

  // eslint-disable-next-line no-console
  console.log(`Seeding ${dates.length} dates x ${SYMBOLS.length} symbols = ${dates.length * SYMBOLS.length} cycles...\n`);

  let completed = 0;
  let failed = 0;

  for (const date of dates) {
    for (const symbol of SYMBOLS) {
      try {
        const result = await runCycle(symbol, date);
        if (result.status === 'completed') {
          completed++;
          const actionStr = result.action ?? 'HOLD';
          const conv = result.conviction?.toFixed(2) ?? '—';
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${symbol} ${date} → ${actionStr} (conv=${conv}, ${result.totalLatencyMs}ms)`);
        } else {
          failed++;
          // eslint-disable-next-line no-console
          console.log(`  ✗ ${symbol} ${date} → FAILED: ${result.error}`);
        }
      } catch (err: any) {
        failed++;
        // eslint-disable-next-line no-console
        console.log(`  ✗ ${symbol} ${date} → ERROR: ${err.message}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\nCycles: ${completed} completed, ${failed} failed.`);

  // Now settle all proposed trades
  // eslint-disable-next-line no-console
  console.log('\nSettling proposed trades...');
  const settled = await settleProposedPlans();
  // eslint-disable-next-line no-console
  console.log(`Settled ${settled} trade plans.\n`);

  // eslint-disable-next-line no-console
  console.log('Done! Start the dev server to see data in the UI.');
  process.exit(0);
}

function generateTradingDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  let added = 0;
  while (added < count) {
    cursor.setDate(cursor.getDate() - 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue; // skip weekends
    dates.push(cursor.toISOString().slice(0, 10));
    added++;
  }
  return dates.reverse(); // oldest first
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
