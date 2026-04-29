import {
  detectExit,
  applyOpenToSandbox,
  applyCloseToSandbox,
} from './tradePlanLifecycle';
import type { SandboxContext } from '@capitalforge/shared';
import type { DailyBar } from '../../types';

const sandbox: SandboxContext = {
  allocatedCapital: 200,
  currentEquity: 200,
  peakEquity: 200,
  cashBalance: 200,
  positionQty: 0,
  positionSymbol: null,
  positionAvgPrice: null,
  drawdownPct: 0,
};

function bar(low: number, high: number, close: number, ts = '2026-04-29T16:00:00Z'): DailyBar {
  return { timestamp: ts, open: close, high, low, close, volume: 1_000_000 };
}

describe('M5 detectExit', () => {
  const plan = { stop: 95, target1: 110, entry: 100, timeStopBars: 10 };

  it('detects target_hit when intra-bar high reaches target1', () => {
    const out = detectExit(plan, [bar(99, 111, 109)]);
    expect(out?.closeReason).toBe('target_hit');
    expect(out?.exitPrice).toBe(110);
  });

  it('detects stop_hit when intra-bar low reaches stop', () => {
    const out = detectExit(plan, [bar(94, 102, 96)]);
    expect(out?.closeReason).toBe('stop_hit');
    expect(out?.exitPrice).toBe(95);
  });

  it('prefers stop over target when both hit on the same bar (worst-case-for-trader)', () => {
    const out = detectExit(plan, [bar(94, 111, 102)]);
    expect(out?.closeReason).toBe('stop_hit');
  });

  it('time-stops at the configured horizon when neither stop nor target fires', () => {
    const bars = Array.from({ length: 5 }, (_, i) => bar(98, 102, 100, `2026-04-${29 + i}T16:00:00Z`));
    const out = detectExit({ ...plan, timeStopBars: 5 }, bars);
    expect(out?.closeReason).toBe('time_stop');
    expect(out?.exitPrice).toBe(100);
  });

  it('returns null while still inside the horizon with no hit', () => {
    const out = detectExit({ ...plan, timeStopBars: 10 }, [bar(98, 102, 100)]);
    expect(out).toBeNull();
  });

  it('returns null when stop is null (defensive)', () => {
    const out = detectExit({ ...plan, stop: null }, [bar(94, 111, 102)]);
    expect(out).toBeNull();
  });
});

describe('M5 sandbox transitions', () => {
  it('debits cash on open, sets position fields', () => {
    const after = applyOpenToSandbox(sandbox, 'AAPL', 4, 50);
    expect(after.cashBalance).toBe(0);
    expect(after.positionQty).toBe(4);
    expect(after.positionSymbol).toBe('AAPL');
    expect(after.positionAvgPrice).toBe(50);
  });

  it('credits cash on close, clears position when symbol matches', () => {
    const held: SandboxContext = {
      ...sandbox,
      cashBalance: 0,
      positionQty: 4,
      positionSymbol: 'AAPL',
      positionAvgPrice: 50,
    };
    const after = applyCloseToSandbox(held, 'AAPL', 4, 60); // closed at $60
    expect(after.cashBalance).toBe(240);
    expect(after.positionQty).toBe(0);
    expect(after.positionSymbol).toBeNull();
  });

  it('credits cash but leaves another symbol\'s position untouched', () => {
    const held: SandboxContext = {
      ...sandbox,
      cashBalance: 50,
      positionQty: 4,
      positionSymbol: 'AAPL',
      positionAvgPrice: 50,
    };
    // We're not actually holding NVDA, but the helper still credits proceeds for whatever
    // shares were passed. Position fields stay (because sandbox holds AAPL, not NVDA).
    const after = applyCloseToSandbox(held, 'NVDA', 1, 100);
    expect(after.cashBalance).toBe(150);
    expect(after.positionQty).toBe(4);
    expect(after.positionSymbol).toBe('AAPL');
  });
});
