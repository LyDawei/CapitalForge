import { z } from 'zod';
import { ATR, RSI, BollingerBands, OBV, SMA, ROC, ADX } from 'technicalindicators';
import { defineTool } from './types';

const INDICATORS = z.enum([
  'atr14',
  'adx14',
  'rsi2',
  'rsi14',
  'bollinger20',
  'obv',
  'sma200',
  'roc10',
]);

export const getIndicator = defineTool({
  name: 'get_indicator',
  description:
    'Compute a technical indicator the head trader did not get from the specialist reports. Returns the most-recent value plus a short tail of recent values for context.',
  params: z.object({
    name: INDICATORS,
    /** How many recent values to return alongside the latest. */
    tailLength: z.number().int().min(0).max(20).default(5),
  }),
  execute: async ({ name, tailLength }, ctx) => {
    const bars = await ctx.alpaca.getDailyBars(ctx.symbol, 220);
    const close = bars.map((b) => b.close);
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);

    let series: number[] = [];
    switch (name) {
      case 'atr14':
        series = ATR.calculate({ period: 14, high, low, close });
        break;
      case 'adx14':
        series = ADX.calculate({ period: 14, high, low, close }).map((r) => r.adx ?? 0);
        break;
      case 'rsi2':
        series = RSI.calculate({ period: 2, values: close });
        break;
      case 'rsi14':
        series = RSI.calculate({ period: 14, values: close });
        break;
      case 'bollinger20': {
        const bb = BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
        const last = bb[bb.length - 1];
        return {
          name,
          latest: last
            ? { upper: round4(last.upper), middle: round4(last.middle), lower: round4(last.lower), pb: round4(last.pb ?? 0) }
            : null,
          tail: bb.slice(-Math.min(tailLength, bb.length)).map((b) => ({
            upper: round4(b.upper),
            middle: round4(b.middle),
            lower: round4(b.lower),
          })),
          asOf: bars[bars.length - 1]?.timestamp ?? null,
        };
      }
      case 'obv':
        series = OBV.calculate({ close, volume: bars.map((b) => b.volume) });
        break;
      case 'sma200':
        series = SMA.calculate({ period: 200, values: close });
        break;
      case 'roc10':
        series = ROC.calculate({ period: 10, values: close });
        break;
    }
    return {
      name,
      latest: series.length > 0 ? round4(series[series.length - 1]) : null,
      tail: series.slice(-Math.min(tailLength, series.length)).map(round4),
      asOf: bars[bars.length - 1]?.timestamp ?? null,
    };
  },
});

export const getAtrStopSuggestion = defineTool({
  name: 'get_atr_stop_suggestion',
  description:
    'Suggest a stop-loss price based on ATR(14). Returns entry − ATR × multiplier (multiplier defaults to 1.5). Use this if you want a structurally informed stop instead of a flat percentage.',
  params: z.object({
    entry: z.number().positive(),
    multiplier: z.number().positive().max(5).default(1.5),
  }),
  execute: async ({ entry, multiplier }, ctx) => {
    const bars = await ctx.alpaca.getDailyBars(ctx.symbol, 60);
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);
    const close = bars.map((b) => b.close);
    const atrSeries = ATR.calculate({ period: 14, high, low, close });
    const atr = atrSeries[atrSeries.length - 1] ?? 0;
    const stop = entry - atr * multiplier;
    return {
      atr14: round4(atr),
      multiplier,
      entry,
      suggestedStop: round4(stop),
      stopDistancePct: entry > 0 ? round4((entry - stop) / entry) : 0,
    };
  },
});

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
