/**
 * In-process daily-cycle scheduler.
 *
 * Mirrors V1's built-in cron: instead of relying on a host crontab or systemd
 * timer, the running API process schedules its own daily cycle. One process,
 * one container, one thing to deploy — the whole app is `docker compose up`.
 *
 * Behaviour:
 *   - Disabled unless `ENABLE_SCHEDULER=true` (so dev/CI never auto-fire real
 *     LLM cycles).
 *   - Fires `SCHEDULE_CRON` in `SCHEDULE_TZ` (default 4:30pm ET, Mon–Fri).
 *   - Each fire iterates the active strategy's watchlist and runs one cycle per
 *     symbol **sequentially** — the sandbox wallet is shared and threaded per
 *     cycle, so symbols must not run concurrently.
 *   - Overlap-guarded: if a previous run is still going when the next tick
 *     fires (long backfill, slow LLM), the tick is skipped rather than stacked.
 *
 * NOTE: single-instance assumption. If you ever run multiple backend replicas,
 * each would fire its own scheduler — run exactly one with ENABLE_SCHEDULER=true.
 */
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';

import { env } from '../env';
import { prisma } from '../db';
import { runCycle } from './cycleRunner';

let task: ScheduledTask | null = null;
let running = false;

/** Run one cycle per watchlist symbol for `date` (default: today, UTC). */
export async function runDailyCycle(log: FastifyBaseLogger, dateOverride?: string): Promise<void> {
  if (running) {
    log.warn('[scheduler] previous daily cycle still running — skipping this tick');
    return;
  }
  running = true;

  const date = dateOverride ?? new Date().toISOString().slice(0, 10);
  try {
    // Active strategy = latest row (StrategyConfig is append-only), same source
    // the manual runner and cycleRunner read.
    const strategy = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    const symbols = strategy?.watchlist ?? [];
    if (symbols.length === 0) {
      log.warn('[scheduler] active strategy has an empty watchlist — nothing to run');
      return;
    }

    log.info(`[scheduler] daily cycle start: ${symbols.length} symbol(s) @ ${date} — ${symbols.join(', ')}`);
    let ok = 0;
    let failed = 0;
    let costUsd = 0;

    for (const symbol of symbols) {
      try {
        const result = await runCycle(symbol, date);
        costUsd += result.totalCostUsd ?? 0;
        if (result.status === 'completed') {
          ok++;
          log.info(`[scheduler]   ✓ ${symbol}: ${result.action ?? 'HOLD'}`);
        } else {
          failed++;
          log.error(`[scheduler]   ✗ ${symbol}: ${result.error ?? 'failed'}`);
        }
      } catch (err) {
        failed++;
        log.error({ err }, `[scheduler]   ✗ ${symbol}: threw`);
      }
    }

    log.info(`[scheduler] daily cycle done: ${ok} ok, ${failed} failed, $${costUsd.toFixed(2)} spent`);
  } catch (err) {
    log.error({ err }, '[scheduler] daily cycle aborted before running');
  } finally {
    running = false;
  }
}

/** Arm the daily-cycle cron if enabled. Idempotent-safe to call once at boot. */
export function startScheduler(log: FastifyBaseLogger): void {
  if (!env.ENABLE_SCHEDULER) {
    log.info('[scheduler] disabled (set ENABLE_SCHEDULER=true to arm the daily cycle)');
    return;
  }
  if (!cron.validate(env.SCHEDULE_CRON)) {
    log.error(`[scheduler] invalid SCHEDULE_CRON "${env.SCHEDULE_CRON}" — scheduler NOT started`);
    return;
  }

  task = cron.schedule(env.SCHEDULE_CRON, () => void runDailyCycle(log), { timezone: env.SCHEDULE_TZ });
  log.info(
    `[scheduler] armed: "${env.SCHEDULE_CRON}" (${env.SCHEDULE_TZ}); ` +
      `MODE=${env.MODE}, LLM_PROVIDER=${env.LLM_PROVIDER}, dryRun=${env.RUNNER_DRY_RUN}`,
  );
}

/** Stop the cron task (called on server shutdown). */
export function stopScheduler(): void {
  task?.stop();
  task = null;
}
