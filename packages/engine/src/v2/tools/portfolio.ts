import { z } from 'zod';
import { defineTool } from './types';

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const meanX = xs.slice(-n).reduce((s, v) => s + v, 0) / n;
  const meanY = ys.slice(-n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[xs.length - n + i] - meanX;
    const b = ys[ys.length - n + i] - meanY;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push((closes[i] - closes[i - 1]) / Math.max(closes[i - 1], 1));
  }
  return out;
}

export const getCorrelations = defineTool({
  name: 'get_correlations',
  description:
    'Rolling correlation between the current symbol and a list of other symbols (Pearson on daily returns over the lookback window). Use this before opening a position to check it is not redundant with what you already hold.',
  params: z.object({
    vsSymbols: z.array(z.string().min(1)).min(1).max(20),
    lookback: z.number().int().min(5).max(120).default(20),
  }),
  execute: async ({ vsSymbols, lookback }, ctx) => {
    const symbolBars = await ctx.alpaca.getDailyBars(ctx.symbol, lookback + 5);
    const symRet = returns(symbolBars.map((b) => b.close));
    const correlations = await Promise.all(
      vsSymbols.map(async (s) => {
        try {
          const bars = await ctx.alpaca.getDailyBars(s, lookback + 5);
          const r = pearson(symRet, returns(bars.map((b) => b.close)));
          return { symbol: s, correlation: Math.round(r * 100) / 100 };
        } catch (err) {
          return {
            symbol: s,
            correlation: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    return { symbol: ctx.symbol, lookback, correlations };
  },
});

export const getPositionHistory = defineTool({
  name: 'get_position_history',
  description:
    'Past trades on the current symbol within the lookback window. Use this to check whether you have been stopped out repeatedly on this name (revenge-trading guard).',
  params: z.object({
    lookbackDays: z.number().int().min(1).max(365).default(90),
  }),
  execute: async ({ lookbackDays }, ctx) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const trades = await ctx.prisma.tradePlan.findMany({
      where: {
        symbol: ctx.symbol,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        status: true,
        closeReason: true,
        realizedPnl: true,
        riskDollars: true,
        entry: true,
        stop: true,
        createdAt: true,
        closedAt: true,
      },
    });
    const stopouts = trades.filter((t) => t.closeReason === 'stop_hit').length;
    const wins = trades.filter((t) => (t.realizedPnl ?? 0) > 0).length;
    return {
      symbol: ctx.symbol,
      lookbackDays,
      total: trades.length,
      stopouts,
      wins,
      losses: trades.filter((t) => t.status === 'closed' && (t.realizedPnl ?? 0) <= 0).length,
      recent: trades.slice(0, 5).map((t) => ({
        action: t.action,
        status: t.status,
        closeReason: t.closeReason,
        realizedPnl: t.realizedPnl,
        entry: t.entry,
        stop: t.stop,
        when: t.createdAt,
      })),
    };
  },
});
