/**
 * CLI: run a single cycle for one symbol on one date.
 *
 * Usage:
 *   npx tsx scripts/run-cycle.ts --symbol SPY --date 2026-05-14
 *   npx tsx scripts/run-cycle.ts  (defaults: SPY, today)
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const args = process.argv.slice(2);
  const symbolIdx = args.indexOf('--symbol');
  const dateIdx = args.indexOf('--date');

  const symbol = symbolIdx >= 0 ? args[symbolIdx + 1] ?? 'SPY' : 'SPY';
  const date = dateIdx >= 0 ? args[dateIdx + 1] ?? todayStr() : todayStr();

  // eslint-disable-next-line no-console
  console.log(`Running cycle: ${symbol} @ ${date}`);

  const { runCycle } = await import('../backend/src/runner');
  const result = await runCycle(symbol, date);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'completed' ? 0 : 1);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
