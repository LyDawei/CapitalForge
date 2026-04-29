import { z } from 'zod';
import { defineTool } from './types';

export const getRecentNews = defineTool({
  name: 'get_recent_news',
  description:
    'Recent news articles for the current symbol. Use this if the newsEvents specialist had low confidence or you want to verify a specific catalyst.',
  params: z.object({
    lookbackDays: z.number().int().min(1).max(60).default(7),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  execute: async ({ lookbackDays, limit }, ctx) => {
    if (!ctx.news) {
      return { articles: [], note: 'news service unavailable' };
    }
    const data = await ctx.news.fetchNewsData(ctx.symbol);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const filtered = data.articles
      .filter((a) => new Date(a.createdAt) >= cutoff)
      .slice(0, limit)
      .map((a) => ({
        headline: a.headline,
        source: a.source,
        createdAt: a.createdAt,
        url: a.url,
        summary: a.summary.slice(0, 240),
      }));
    return { articles: filtered, lookbackDays };
  },
});

export const getEarningsCalendar = defineTool({
  name: 'get_earnings_calendar',
  description:
    'Days until next earnings report (or null if not within the lookback window). Hard gate: avoid opening swing positions when this is <= 2.',
  params: z.object({
    withinDays: z.number().int().min(1).max(60).default(14),
  }),
  execute: async ({ withinDays }, ctx) => {
    // We don't have a real earnings feed wired up. Use the newsEvents specialist's
    // extras as the source of truth where possible; otherwise return null.
    const latestSpecialist = await ctx.prisma.specialistAnalysis.findFirst({
      where: { specialistName: 'newsEvents' },
      orderBy: { createdAt: 'desc' },
      select: { extras: true, cycleId: true, createdAt: true },
    });
    const extras = latestSpecialist?.extras as
      | { earningsWithinDays?: number | null; catalystImminent?: boolean }
      | null
      | undefined;
    const earningsWithinDays = extras?.earningsWithinDays ?? null;
    return {
      symbol: ctx.symbol,
      earningsWithinDays:
        earningsWithinDays !== null && earningsWithinDays <= withinDays ? earningsWithinDays : null,
      catalystImminent: extras?.catalystImminent ?? false,
      source: latestSpecialist ? 'newsEvents-specialist' : 'unknown',
    };
  },
});
