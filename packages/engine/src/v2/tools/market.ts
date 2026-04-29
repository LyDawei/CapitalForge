import { z } from 'zod';
import { SMA } from 'technicalindicators';
import { defineTool } from './types';
import { DailyBar } from '../../types';

const SECTOR_ETFS: Record<string, string> = {
  technology: 'XLK',
  financials: 'XLF',
  energy: 'XLE',
  healthcare: 'XLV',
  industrials: 'XLI',
  consumer_discretionary: 'XLY',
  consumer_staples: 'XLP',
  utilities: 'XLU',
  materials: 'XLB',
  real_estate: 'XLRE',
  communications: 'XLC',
};

function pctChange(bars: DailyBar[], lookback: number): number | null {
  if (bars.length < lookback + 1) return null;
  const last = bars[bars.length - 1].close;
  const prev = bars[bars.length - 1 - lookback].close;
  return prev > 0 ? (last - prev) / prev : 0;
}

export const getMarketRegime = defineTool({
  name: 'get_market_regime',
  description:
    'Snapshot of the broader market: SPY vs its SMA200, recent SPY return, and a coarse VIX-proxy from SPY range. Use this to decide whether trend longs are in scope or whether the regime is hostile.',
  params: z.object({}),
  execute: async (_args, ctx) => {
    const bars = await ctx.alpaca.getDailyBars('SPY', 220);
    if (bars.length < 200) {
      return { regime: 'unknown', reason: `only ${bars.length} SPY bars available` };
    }
    const close = bars.map((b) => b.close);
    const sma200Series = SMA.calculate({ period: 200, values: close });
    const sma200 = sma200Series[sma200Series.length - 1] ?? 0;
    const last = close[close.length - 1];
    const spyVsSma200 = sma200 > 0 ? (last - sma200) / sma200 : 0;

    // Cheap volatility proxy: average daily range / close over last 10 bars
    const recent10 = bars.slice(-10);
    const avgRangePct =
      recent10.reduce((s, b) => s + (b.high - b.low) / Math.max(b.close, 1), 0) / recent10.length;
    const volBucket =
      avgRangePct < 0.012 ? 'low' : avgRangePct < 0.022 ? 'normal' : 'elevated';

    const ret5 = pctChange(bars, 5);
    const ret20 = pctChange(bars, 20);

    const regime =
      spyVsSma200 >= 0.02 && (ret20 ?? 0) > 0
        ? 'bull_trending'
        : spyVsSma200 >= 0
          ? 'bull_choppy'
          : (ret20 ?? 0) < -0.05
            ? 'bear_trending'
            : 'bear_choppy';

    return {
      regime,
      spyClose: round2(last),
      spyVsSma200: round4(spyVsSma200),
      ret5: ret5 !== null ? round4(ret5) : null,
      ret20: ret20 !== null ? round4(ret20) : null,
      volBucket,
      avgRangePct: round4(avgRangePct),
    };
  },
});

export const getSectorPerformance = defineTool({
  name: 'get_sector_performance',
  description:
    'Sector ETF performance over 1d/5d/20d. Pass a sector key (e.g. "technology") to focus on one, or omit to see all eleven SPDR sector ETFs.',
  params: z.object({
    sector: z
      .enum([
        'technology',
        'financials',
        'energy',
        'healthcare',
        'industrials',
        'consumer_discretionary',
        'consumer_staples',
        'utilities',
        'materials',
        'real_estate',
        'communications',
      ])
      .optional(),
  }),
  execute: async ({ sector }, ctx) => {
    const targets = sector ? [SECTOR_ETFS[sector]] : Object.values(SECTOR_ETFS);
    const out = await Promise.all(
      targets.map(async (etf) => {
        const bars = await ctx.alpaca.getDailyBars(etf, 30);
        return {
          etf,
          ret1d: pctChange(bars, 1),
          ret5d: pctChange(bars, 5),
          ret20d: pctChange(bars, 20),
          lastClose: bars[bars.length - 1]?.close ?? null,
        };
      })
    );
    return { sectors: out };
  },
});

export const getRelativeStrength = defineTool({
  name: 'get_relative_strength',
  description:
    'Relative strength of the current symbol vs a benchmark (default SPY). Returns ratio change over the lookback window — positive means the symbol outperformed, negative means it lagged.',
  params: z.object({
    benchmark: z.string().min(1).default('SPY'),
    lookback: z.number().int().min(2).max(120).default(20),
  }),
  execute: async ({ benchmark, lookback }, ctx) => {
    const [symbolBars, benchBars] = await Promise.all([
      ctx.alpaca.getDailyBars(ctx.symbol, lookback + 5),
      ctx.alpaca.getDailyBars(benchmark, lookback + 5),
    ]);
    if (symbolBars.length < lookback + 1 || benchBars.length < lookback + 1) {
      return { error: 'insufficient bars' };
    }
    const symbolReturn = pctChange(symbolBars, lookback) ?? 0;
    const benchReturn = pctChange(benchBars, lookback) ?? 0;
    const rs = symbolReturn - benchReturn;
    return {
      symbol: ctx.symbol,
      benchmark,
      lookback,
      symbolReturn: round4(symbolReturn),
      benchReturn: round4(benchReturn),
      relativeStrength: round4(rs),
      verdict: rs > 0.02 ? 'leader' : rs < -0.02 ? 'laggard' : 'in_line',
    };
  },
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
