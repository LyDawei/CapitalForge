/**
 * Historical backfill — run cycles over a date range × symbol list so the
 * audit pipeline accumulates real sample size in one batch instead of waiting
 * months in calendar time.
 *
 * Resumable: skips (date, symbol) pairs that already have a completed Cycle
 * row. Re-running after a crash picks up where it left off.
 *
 * Usage:
 *   npx tsx scripts/backfill.ts \
 *     --symbols SPY,AAPL,NVDA,TSLA,MSFT,AMZN \
 *     --start 2026-02-19 \
 *     --end 2026-05-19 \
 *     [--dry-run]
 *
 * Defaults: 6 symbols × 90 trading days ending today.
 *
 * Cost (gpt-4o head trader + gpt-4o-mini specialists/audit/critic):
 *   ~$0.05–$0.07 per cycle. 540 cycles ≈ $30–$40 total.
 * Mock mode (LLM_PROVIDER=mock or no key) is free but the calibration data
 * isn't useful for production validation.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { runCycle } from '../backend/src/runner/cycleRunner';
import { prisma } from '../backend/src/db';

interface Args {
  symbols: string[];
  start: Date;
  end: Date;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  function valFor(flag: string): string | undefined {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  }
  const today = new Date();
  const ninetyAgo = new Date(today);
  ninetyAgo.setUTCDate(ninetyAgo.getUTCDate() - 130); // ~90 trading days
  return {
    symbols: (valFor('--symbols') ?? 'SPY,AAPL,NVDA,TSLA,MSFT,AMZN').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    start: new Date(valFor('--start') ?? ninetyAgo.toISOString().slice(0, 10)),
    end: new Date(valFor('--end') ?? today.toISOString().slice(0, 10)),
    dryRun: argv.includes('--dry-run'),
  };
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs();

  // Build the date list (weekdays only).
  const dates: string[] = [];
  for (let d = new Date(args.start); d <= args.end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWeekday(d)) dates.push(ymd(d));
  }

  const totalPlanned = args.symbols.length * dates.length;
  console.log(`Backfill plan: ${args.symbols.length} symbols × ${dates.length} weekdays = ${totalPlanned} cycles`);
  console.log(`  Symbols: ${args.symbols.join(', ')}`);
  console.log(`  Range: ${ymd(args.start)} → ${ymd(args.end)}`);

  // Existing cycles (resumability) — query once up front.
  const existing = await prisma.cycle.findMany({
    where: {
      symbol: { in: args.symbols },
      date: { in: dates },
      status: 'completed',
    },
    select: { date: true, symbol: true },
  });
  const existingKeys = new Set(existing.map((c) => `${c.date}|${c.symbol}`));
  console.log(`  Already completed: ${existingKeys.size}`);
  const queue: Array<{ date: string; symbol: string }> = [];
  for (const date of dates) {
    for (const symbol of args.symbols) {
      if (!existingKeys.has(`${date}|${symbol}`)) queue.push({ date, symbol });
    }
  }
  console.log(`  To run: ${queue.length}`);

  if (args.dryRun) {
    console.log('\n--dry-run set, exiting without executing.');
    await prisma.$disconnect();
    return;
  }
  if (queue.length === 0) {
    console.log('\nNothing to do — every cycle in range already exists.');
    await prisma.$disconnect();
    return;
  }

  console.log('');
  let succeeded = 0;
  let failed = 0;
  let totalCostUsd = 0;
  const t0 = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    const pct = (((i + 1) / queue.length) * 100).toFixed(1);
    const elapsed = (Date.now() - t0) / 1000;
    const ratePerSec = (i + 1) / elapsed;
    const etaSec = ratePerSec > 0 ? (queue.length - i - 1) / ratePerSec : 0;
    const etaMin = (etaSec / 60).toFixed(1);

    process.stdout.write(
      `[${i + 1}/${queue.length} ${pct}%] ${item.symbol} @ ${item.date}  cost=$${totalCostUsd.toFixed(2)}  eta=${etaMin}m   `,
    );

    try {
      const result = await runCycle(item.symbol, item.date);
      if (result.status === 'completed') {
        succeeded++;
        totalCostUsd += result.totalCostUsd ?? 0;
        process.stdout.write(`✓ ${result.action ?? 'HOLD'}  $${(result.totalCostUsd ?? 0).toFixed(4)}\n`);
      } else {
        failed++;
        process.stdout.write(`✗ ${result.error ?? 'unknown failure'}\n`);
      }
    } catch (err: any) {
      failed++;
      process.stdout.write(`✗ ${err.message}\n`);
    }
  }

  const elapsedTotal = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n--- backfill complete ---`);
  console.log(`  succeeded: ${succeeded}`);
  console.log(`  failed:    ${failed}`);
  console.log(`  cost:      $${totalCostUsd.toFixed(2)}`);
  console.log(`  elapsed:   ${elapsedTotal} min`);

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
