import { computeTechnicals } from './technicals';
import type { DailyBar } from '../services/alpaca';

function makeBars(count: number, baseClose = 100): DailyBar[] {
  const bars: DailyBar[] = [];
  for (let i = 0; i < count; i++) {
    // Gentle uptrend with some noise
    const close = baseClose + i * 0.3 + Math.sin(i * 0.5) * 2;
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close: +close.toFixed(2),
      volume: 1_000_000 + i * 10_000,
    });
  }
  return bars;
}

describe('computeTechnicals', () => {
  it('throws if fewer than 50 bars', () => {
    expect(() => computeTechnicals('SPY', makeBars(30))).toThrow('Need >= 50 bars');
  });

  it('computes all fields for 65 bars', () => {
    const bars = makeBars(65);
    const tech = computeTechnicals('SPY', bars);

    expect(tech.symbol).toBe('SPY');
    expect(tech.date).toBe(bars[64]!.date);
    expect(tech.close).toBe(bars[64]!.close);

    // RSI should be a number between 0 and 100
    expect(tech.rsi).toBeGreaterThanOrEqual(0);
    expect(tech.rsi).toBeLessThanOrEqual(100);

    // SMAs should be in a reasonable range
    expect(tech.sma20).toBeGreaterThan(90);
    expect(tech.sma20).toBeLessThan(130);
    expect(tech.sma50).toBeGreaterThan(90);
    expect(tech.sma50).toBeLessThan(130);

    // SMA20 should be higher than SMA50 in an uptrend
    expect(tech.sma20).toBeGreaterThan(tech.sma50);

    // MACD histogram is a number
    expect(typeof tech.macdHistogram).toBe('number');

    // Volume and avgVolume
    expect(tech.volume).toBeGreaterThan(0);
    expect(tech.avgVolume).toBeGreaterThan(0);
  });

  it('RSI is high for strong uptrend', () => {
    // Monotonic uptrend
    const bars: DailyBar[] = [];
    for (let i = 0; i < 65; i++) {
      const close = 100 + i * 2;
      bars.push({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: close - 1,
        high: close + 0.5,
        low: close - 1.5,
        close,
        volume: 1_000_000,
      });
    }
    const tech = computeTechnicals('TEST', bars);
    expect(tech.rsi).toBeGreaterThan(70);
  });

  it('RSI is low for strong downtrend', () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 65; i++) {
      const close = 200 - i * 2;
      bars.push({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: close + 1,
        high: close + 1.5,
        low: close - 0.5,
        close,
        volume: 1_000_000,
      });
    }
    const tech = computeTechnicals('TEST', bars);
    expect(tech.rsi).toBeLessThan(30);
  });

  it('SMA200 is null when fewer than 200 bars', () => {
    const tech = computeTechnicals('SPY', makeBars(65));
    expect(tech.sma200).toBeNull();
  });

  it('SMA200 is computed when 200+ bars are provided', () => {
    const tech = computeTechnicals('SPY', makeBars(220));
    expect(tech.sma200).not.toBeNull();
    expect(tech.sma200).toBeGreaterThan(80);
    // In a steady uptrend, SMA200 < SMA50 < SMA20
    expect(tech.sma200!).toBeLessThan(tech.sma50);
    expect(tech.sma50).toBeLessThan(tech.sma20);
  });

  it('ATR is positive and roughly equals high-low range for steady-bar series', () => {
    const tech = computeTechnicals('SPY', makeBars(65));
    expect(tech.atr14).toBeGreaterThan(0);
    // makeBars sets high = close+1, low = close-1, so true-range floor is 2.
    // With small day-over-day moves, ATR should be in the ~2-3 range.
    expect(tech.atr14).toBeGreaterThan(1.5);
    expect(tech.atr14).toBeLessThan(4);
  });

  it('ATR expands with bigger price moves', () => {
    const calm: DailyBar[] = [];
    const volatile: DailyBar[] = [];
    for (let i = 0; i < 65; i++) {
      calm.push({
        date: `2026-01-${i + 1}`, open: 100, high: 100.5, low: 99.5, close: 100,
        volume: 1_000_000,
      });
      const big = 100 + (i % 2 === 0 ? 5 : -5);
      volatile.push({
        date: `2026-01-${i + 1}`, open: big, high: big + 5, low: big - 5, close: big,
        volume: 1_000_000,
      });
    }
    expect(computeTechnicals('CALM', calm).atr14).toBeLessThan(
      computeTechnicals('VOL', volatile).atr14,
    );
  });

  it('atrPct is atr14 / close', () => {
    const tech = computeTechnicals('SPY', makeBars(65));
    expect(tech.atrPct).toBeCloseTo(tech.atr14 / tech.close, 6);
  });
});
