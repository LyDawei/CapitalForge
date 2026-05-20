/**
 * Feed audit wrapper. Every external-data pull goes through here so the
 * FeedFetch table has one row per fetch, every time, regardless of which
 * service made the call. Joined to AgentRun via `recordConsumption` so the
 * audit UI can answer "what decisions were made because of this fetch?"
 *
 * The wrapper is non-throwing on fetch failure: it records an errored
 * FeedFetch row and returns `{ data: null, feedFetchId, errored: true }`
 * so callers can decide whether to fall back, ignore, or bail. The agents
 * that consume feeds are responsible for behaving sensibly with partial /
 * empty data — that's documented in the agent prompts.
 */
import { prisma } from '../db';

export interface FetchWithAuditArgs<T> {
  /// Stable name for the source. Lowercase + underscores. Used by the UI to
  /// group fetches and by audit queries. Examples:
  ///   'alpaca_news', 'finnhub_company_news', 'finnhub_earnings',
  ///   'finnhub_economic_calendar', 'fred_dgs10', 'fred_vixcls', 'fred_dtwexbgs'.
  source: string;
  /// Symbol the fetch is for. Null for macro / market-wide feeds.
  symbol?: string;
  /// Canonical request URL or article URL — what we'd link to from the audit UI.
  url?: string;
  /// Estimated dollar cost. Useful for paid APIs (Finnhub paid tier, OpenAI
  /// web-search if we ever wire it). Free APIs pass 0 / undefined.
  costUsd?: number;
  /// The actual call. Returns the normalized payload the caller will pass
  /// into the agent's prompt.
  fetcher: () => Promise<T>;
}

export interface FetchWithAuditResult<T> {
  /// Normalized response. Null when `errored` is true.
  data: T | null;
  /// FeedFetch row ID. Always populated, even on error, so consumption rows
  /// can still record "this agent saw this attempt."
  feedFetchId: string;
  errored: boolean;
}

export async function fetchWithAudit<T>(
  args: FetchWithAuditArgs<T>,
): Promise<FetchWithAuditResult<T>> {
  const start = Date.now();
  try {
    const data = await args.fetcher();
    const latencyMs = Date.now() - start;
    const row = await prisma.feedFetch.create({
      data: {
        source: args.source,
        symbol: args.symbol ?? null,
        url: args.url ?? null,
        payload: data as any,
        latencyMs,
        costUsd: args.costUsd ?? null,
        errored: false,
      },
    });
    return { data, feedFetchId: row.id, errored: false };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const row = await prisma.feedFetch.create({
      data: {
        source: args.source,
        symbol: args.symbol ?? null,
        url: args.url ?? null,
        payload: {} as any,
        latencyMs,
        costUsd: args.costUsd ?? null,
        errored: true,
        errorMessage: String(err?.message ?? err).slice(0, 1000),
      },
    });
    return { data: null, feedFetchId: row.id, errored: true };
  }
}

/**
 * Record that a specific AgentRun consumed one or more FeedFetches. Called
 * after the agent has run + returned its output, so the (optional)
 * influenceTag can reflect the actual decision the agent made.
 */
export async function recordConsumption(args: {
  feedFetchIds: string[];
  agentRunId: string;
  cycleId?: string;
  influenceTag?: string;
}): Promise<void> {
  if (args.feedFetchIds.length === 0) return;
  await prisma.feedConsumption.createMany({
    data: args.feedFetchIds.map((feedFetchId) => ({
      feedFetchId,
      agentRunId: args.agentRunId,
      cycleId: args.cycleId ?? null,
      influenceTag: args.influenceTag ?? null,
    })),
  });
}
