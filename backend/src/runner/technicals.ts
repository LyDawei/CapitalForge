import type { DailyBar } from '../services/alpaca';

/**
 * Computed technical indicators for a single point in time, derived from bars.
 */
export interface Technicals {
  date: string;
  symbol: string;
  close: number;
  rsi: number;
  sma20: number;
  sma50: number;
  /// 200-day SMA. Null when fewer than 200 bars are available. Required for
  /// Stage 1-4 classification (price above/below the 200 is the regime spine).
  sma200: number | null;
  macdHistogram: number;
  macdLine: number;
  signalLine: number;
  /// Average True Range over 14 bars. Volatility measure used for stop sizing
  /// and to evaluate volatility expansion/compression.
  atr14: number;
  /// atr14 / close — useful for the LLM to reason about relative volatility.
  atrPct: number;
  volume: number;
  avgVolume: number; // 30-bar avg
}

/**
 * Compute technicals from the most recent bar. Needs ≥ 50 bars for SMA50.
 * SMA200 is reported as null when there's < 200 bars (callers should treat as
 * "regime classification confidence should be lower").
 */
export function computeTechnicals(symbol: string, bars: DailyBar[]): Technicals {
  if (bars.length < 50) {
    throw new Error(`Need >= 50 bars, got ${bars.length} for ${symbol}`);
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const latest = bars[bars.length - 1]!;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = bars.length >= 200 ? sma(closes, 200) : null;
  const rsi = computeRsi(closes, 14);
  const { macdLine, signalLine, histogram } = computeMacd(closes, 12, 26, 9);
  const atr14 = computeAtr(bars, 14);
  const atrPct = latest.close > 0 ? atr14 / latest.close : 0;
  const avgVolume = sma(volumes, 30);

  return {
    date: latest.date,
    symbol,
    close: latest.close,
    rsi,
    sma20,
    sma50,
    sma200,
    macdHistogram: histogram,
    macdLine,
    signalLine,
    atr14,
    atrPct,
    volume: latest.volume,
    avgVolume,
  };
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i]! * k + result[i - 1]! * (1 - k));
  }
  return result;
}

function computeRsi(closes: number[], period: number): number {
  let gains = 0;
  let losses = 0;
  // seed with the first `period` changes
  for (let i = 1; i <= period && i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder-smooth through the rest
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta >= 0) {
      avgGain = (avgGain * (period - 1) + delta) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - delta) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeMacd(
  closes: number[],
  fast: number,
  slow: number,
  signal: number,
): { macdLine: number; signalLine: number; histogram: number } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdValues = emaFast.map((f, i) => f - emaSlow[i]!);
  const signalValues = ema(macdValues, signal);
  const last = macdValues.length - 1;
  const macdLine = macdValues[last]!;
  const signalLineVal = signalValues[last]!;
  return { macdLine, signalLine: signalLineVal, histogram: macdLine - signalLineVal };
}

/**
 * Wilder-smoothed Average True Range over `period` bars.
 *
 * True Range for a bar = max(
 *   high - low,
 *   |high - prevClose|,
 *   |low  - prevClose|
 * )
 *
 * Falls back to a simple high-low for the first bar (no prevClose available).
 * Returns 0 if fewer bars than `period` are provided.
 */
function computeAtr(bars: DailyBar[], period: number): number {
  if (bars.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (i === 0) {
      trs.push(b.high - b.low);
    } else {
      const prevClose = bars[i - 1]!.close;
      trs.push(
        Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose)),
      );
    }
  }
  // Wilder smoothing: first ATR is the simple mean of the first `period` TRs,
  // then each subsequent ATR = ((prevAtr * (period-1)) + currentTR) / period.
  const seed = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let atr = seed;
  for (let i = period + 1; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]!) / period;
  }
  return atr;
}
