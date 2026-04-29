/**
 * Manual settler: walk every status='proposed' BUY plan forward and settle it
 * counterfactually based on subsequent bars. Useful for backfilling outcomes
 * after a batch of cycles run, before M5 lifecycle replaces this.
 *
 * Usage:
 *   npm run settle-plans -w @capitalforge/engine
 *   npm run settle-plans -w @capitalforge/engine -- --min-days-old 0
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { loadConfig } from '../src/config';
import { createAlpacaService } from '../src/services/alpaca';
import { createMockAlpacaService } from '../src/services/alpaca.mock';
import { getPrismaClient, disconnectPrisma } from '../src/services/db';
import { settleProposedPlans } from '../src/v2/engine/settlePlans';

function parseArgs(): { minDaysOld: number; maxToSettle: number } {
  const args = process.argv.slice(2);
  const minIdx = args.indexOf('--min-days-old');
  const maxIdx = args.indexOf('--max');
  return {
    minDaysOld: minIdx !== -1 ? parseInt(args[minIdx + 1] ?? '1', 10) : 0,
    maxToSettle: maxIdx !== -1 ? parseInt(args[maxIdx + 1] ?? '200', 10) : 200,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const alpaca = config.mode === 'mock' ? createMockAlpacaService() : createAlpacaService(config);
  const prisma = getPrismaClient();
  const opts = parseArgs();

  console.log(`Settling proposed BUY plans (mode=${config.mode}, minDaysOld=${opts.minDaysOld})…`);
  const result = await settleProposedPlans(prisma, alpaca, opts);
  console.log(`Scanned: ${result.scanned}`);
  console.log(`Settled: ${result.settled}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.failures.length > 0) {
    console.log(`Failures (${result.failures.length}):`);
    for (const f of result.failures) console.log(`  ${f.tradePlanId}: ${f.reason}`);
  }
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectPrisma();
  process.exit(1);
});
