/**
 * Per-agent feed orchestration. Fetches the external data each agent needs,
 * formats it as a prompt context block, and tracks the FeedFetch IDs so the
 * runner can record consumption rows after the agent has run.
 *
 * Three agents have feed dependencies today:
 *   - newsEvents         → Alpaca news, Finnhub company news, Finnhub earnings
 *   - macroContext       → Alpaca SPY/QQQ + sector ETFs, FRED 10Y / VIX / dollar
 *   - liquiditySlippage  → Alpaca latest quote (NBBO) + asset info (shortable, etc.)
 *
 * Every fetch goes through `fetchWithAudit` so the FeedFetch table has a
 * row per pull, every time. The agents themselves never call services
 * directly — the runner stages everything here.
 */
import { getAlpacaService } from '../services/alpaca';
import { getFinnhubService } from '../services/finnhub';
import { getFredService } from '../services/fred';

export interface FeedBundle {
  /// Pre-rendered text to inject into the agent's prompt under a clearly
  /// labeled section. Empty string means no feeds were available (key
  /// missing, network error, etc.) — the agent prompt instructs the agent
  /// to behave honestly with low confidence in that case.
  contextBlock: string;
  /// FeedFetch row IDs from this batch. The runner writes one
  /// FeedConsumption row per (id, agentRunId) after the agent has run.
  feedFetchIds: string[];
}

const NEWS_LOOKBACK_DAYS = 7;
const EARNINGS_LOOKAHEAD_DAYS = 14;
const ECON_LOOKAHEAD_DAYS = 7;
const FRED_RECENT_OBSERVATIONS = 5;
const SECTOR_ETFS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLP', 'XLY', 'XLB', 'XLU', 'XLRE', 'XLC'];

// ===========================================================================
// newsEvents
// ===========================================================================
export async function fetchNewsEventsBundle(symbol: string): Promise<FeedBundle> {
  const alpaca = getAlpacaService();
  const finnhub = getFinnhubService();
  const ids: string[] = [];

  const [alpacaNews, finnhubNews, earnings, econ] = await Promise.all([
    alpaca.getNews(symbol, NEWS_LOOKBACK_DAYS),
    finnhub.getCompanyNews(symbol, NEWS_LOOKBACK_DAYS),
    finnhub.getEarningsCalendar(symbol, EARNINGS_LOOKAHEAD_DAYS),
    finnhub.getEconomicCalendar(ECON_LOOKAHEAD_DAYS),
  ]);
  for (const r of [alpacaNews, finnhubNews, earnings, econ]) ids.push(r.feedFetchId);

  // The agent's prompt expects compact, decision-relevant fields — not raw
  // article bodies. Trim summaries hard so the prompt stays under control.
  const alpacaLines = (alpacaNews.data ?? []).slice(0, 8).map((a) =>
    `  [${a.createdAt.slice(0, 10)}] (${a.source}) ${a.headline.slice(0, 140)}`,
  );
  const finnhubLines = (finnhubNews.data ?? []).slice(0, 8).map((a) =>
    `  [${new Date(a.datetime * 1000).toISOString().slice(0, 10)}] (${a.source}) ${a.headline.slice(0, 140)}`,
  );
  const earningsLines = (earnings.data ?? []).map((e) =>
    `  ${e.date} ${e.hour || '?'} EPS_est=${e.epsEstimate ?? 'n/a'}`,
  );
  const econLines = (econ.data ?? []).map((e) =>
    `  ${e.time.slice(0, 10)} ${e.event} (${e.impact}) est=${e.estimate ?? 'n/a'} prev=${e.previous ?? 'n/a'}`,
  );

  const sections: string[] = [];
  if (alpacaLines.length) sections.push(`Alpaca news (${alpacaLines.length}):\n${alpacaLines.join('\n')}`);
  if (finnhubLines.length) sections.push(`Finnhub company news (${finnhubLines.length}):\n${finnhubLines.join('\n')}`);
  if (earningsLines.length) {
    sections.push(`Earnings calendar (next ${EARNINGS_LOOKAHEAD_DAYS}d, ${earningsLines.length} event(s)):\n${earningsLines.join('\n')}`);
  } else {
    sections.push(`Earnings calendar (next ${EARNINGS_LOOKAHEAD_DAYS}d): none scheduled.`);
  }
  if (econLines.length) sections.push(`US macro calendar (next ${ECON_LOOKAHEAD_DAYS}d):\n${econLines.join('\n')}`);

  const errors = [alpacaNews, finnhubNews, earnings, econ].filter((r) => r.errored);
  if (errors.length) {
    sections.push(`Feed errors: ${errors.length} source(s) returned empty or errored.`);
  }

  return {
    contextBlock: sections.length
      ? `--- NEWS & EVENTS FEEDS ---\n${sections.join('\n\n')}`
      : `--- NEWS & EVENTS FEEDS ---\n(no data — operating in no-feed mode)`,
    feedFetchIds: ids,
  };
}

// ===========================================================================
// macroContext
// ===========================================================================
export async function fetchMacroContextBundle(): Promise<FeedBundle> {
  const alpaca = getAlpacaService();
  const fred = getFredService();
  const ids: string[] = [];

  // 1) Broad-market regime via SPY + QQQ recent bars. We treat the Alpaca
  //    bars call as its own feed-fetch entry per symbol so the audit log
  //    captures the regime read separately for each.
  // NOTE: getDailyBars is the existing AlpacaService method and isn't yet
  // wrapped in fetchWithAudit (it's been there since before the feed audit
  // tables existed). For macroContext we wrap explicitly here so the macro
  // pulls show up in the audit UI alongside Finnhub / FRED.
  const { fetchWithAudit } = await import('../services/feedLog');

  const indexRefs = await Promise.all(
    ['SPY', 'QQQ'].map((sym) =>
      fetchWithAudit({
        source: 'alpaca_index_bars',
        symbol: sym,
        url: `internal://alpaca/bars/${sym}/recent`,
        fetcher: async () => {
          const bars = await alpaca.getDailyBars(sym, 30);
          // Compact summary — the agent reads the trend slope, not 30 bars
          // worth of OHLCV.
          if (bars.length < 2) return { symbol: sym, trend: 'unknown', latest: null };
          const first = bars[0]!.close;
          const last = bars[bars.length - 1]!.close;
          const pctChange = ((last - first) / first) * 100;
          return {
            symbol: sym,
            latestClose: +last.toFixed(2),
            pctChange30d: +pctChange.toFixed(2),
            trend: pctChange > 1 ? 'up' : pctChange < -1 ? 'down' : 'flat',
          };
        },
      }),
    ),
  );
  for (const r of indexRefs) ids.push(r.feedFetchId);

  // 2) Sector ETF performance — relative ranking helps the agent identify
  //    risk-on / risk-off rotation. Fetched in parallel; failures are
  //    tolerated per-symbol (one ETF outage doesn't poison the regime read).
  const sectorRefs = await Promise.all(
    SECTOR_ETFS.map((sym) =>
      fetchWithAudit({
        source: 'alpaca_sector_etf',
        symbol: sym,
        url: `internal://alpaca/bars/${sym}/recent`,
        fetcher: async () => {
          const bars = await alpaca.getDailyBars(sym, 5);
          if (bars.length < 2) return { symbol: sym, pctChange5d: null };
          const first = bars[0]!.close;
          const last = bars[bars.length - 1]!.close;
          return {
            symbol: sym,
            pctChange5d: +(((last - first) / first) * 100).toFixed(2),
          };
        },
      }),
    ),
  );
  for (const r of sectorRefs) ids.push(r.feedFetchId);

  // 3) FRED series — 10Y yield, VIX, dollar index. Each is its own audit row.
  const [dgs10, vix, dxy] = await Promise.all([
    fred.getRecent('DGS10', FRED_RECENT_OBSERVATIONS),
    fred.getRecent('VIXCLS', FRED_RECENT_OBSERVATIONS),
    fred.getRecent('DTWEXBGS', FRED_RECENT_OBSERVATIONS),
  ]);
  for (const r of [dgs10, vix, dxy]) ids.push(r.feedFetchId);

  // Direction helper: compare newest to oldest observation in the window.
  const direction = (obs: { value: number | null }[] | null): 'rising' | 'falling' | 'flat' | 'unknown' => {
    if (!obs || obs.length < 2) return 'unknown';
    const newest = obs[0]?.value;
    const oldest = obs[obs.length - 1]?.value;
    if (newest == null || oldest == null) return 'unknown';
    const delta = newest - oldest;
    if (Math.abs(delta) < 0.01) return 'flat';
    return delta > 0 ? 'rising' : 'falling';
  };

  // 4) Format the prompt context block.
  const sections: string[] = [];
  const indexSummary = indexRefs
    .map((r) => {
      const d = r.data as { symbol: string; trend?: string; latestClose?: number; pctChange30d?: number } | null;
      return d
        ? `  ${d.symbol}: ${d.trend ?? 'unknown'} (close=${d.latestClose ?? '?'}, 30d=${d.pctChange30d ?? '?'}%)`
        : '';
    })
    .filter(Boolean);
  if (indexSummary.length) sections.push(`Broad-market regime (Alpaca):\n${indexSummary.join('\n')}`);

  const sectorSummary = sectorRefs
    .map((r) => r.data as { symbol: string; pctChange5d: number | null } | null)
    .filter((d): d is { symbol: string; pctChange5d: number | null } => d != null && d.pctChange5d != null)
    .sort((a, b) => (b.pctChange5d ?? 0) - (a.pctChange5d ?? 0));
  if (sectorSummary.length) {
    sections.push(
      `Sector ETF performance (5d %, ranked):\n` +
        sectorSummary.map((s, i) => `  ${i + 1}. ${s.symbol}: ${s.pctChange5d}%`).join('\n'),
    );
  }

  const fredBits: string[] = [];
  for (const [label, ref] of [
    ['10Y yield (DGS10)', dgs10],
    ['VIX (VIXCLS)', vix],
    ['Broad dollar (DTWEXBGS)', dxy],
  ] as const) {
    const obs = ref.data;
    if (!obs || obs.length === 0) {
      fredBits.push(`  ${label}: no data`);
      continue;
    }
    const latest = obs[0];
    fredBits.push(`  ${label}: ${latest?.value ?? 'n/a'} (${direction(obs)})`);
  }
  if (fredBits.length) sections.push(`FRED macro series:\n${fredBits.join('\n')}`);

  const erroredCount = [...indexRefs, ...sectorRefs, dgs10, vix, dxy].filter((r) => r.errored).length;
  if (erroredCount > 0) {
    sections.push(`Feed errors: ${erroredCount} source(s) returned empty or errored.`);
  }

  return {
    contextBlock: sections.length
      ? `--- MACRO CONTEXT FEEDS ---\n${sections.join('\n\n')}`
      : `--- MACRO CONTEXT FEEDS ---\n(no data — operating in no-feed mode)`,
    feedFetchIds: ids,
  };
}

// ===========================================================================
// liquiditySlippage
// ===========================================================================
export async function fetchLiquidityBundle(symbol: string): Promise<FeedBundle> {
  const alpaca = getAlpacaService();
  const ids: string[] = [];

  const [quote, asset] = await Promise.all([
    alpaca.getLatestQuote(symbol),
    alpaca.getAssetInfo(symbol),
  ]);
  ids.push(quote.feedFetchId, asset.feedFetchId);

  const sections: string[] = [];

  if (quote.data) {
    const q = quote.data;
    const dollarDepthBid = q.bid * q.bidSize;
    const dollarDepthAsk = q.ask * q.askSize;
    sections.push(
      `NBBO quote:\n` +
        `  bid=${q.bid}  ask=${q.ask}  mid=${q.midPrice}\n` +
        `  spreadAbs=$${q.spreadAbs}  spreadBps=${q.spreadBps}\n` +
        `  bidSize=${q.bidSize}sh ($${dollarDepthBid.toFixed(0)} at NBBO)\n` +
        `  askSize=${q.askSize}sh ($${dollarDepthAsk.toFixed(0)} at NBBO)\n` +
        `  quote age: ${q.quoteAgeSeconds}s (IEX free-tier delay floor ≈ 900s)`,
    );
  } else {
    sections.push('NBBO quote: unavailable (feed errored)');
  }

  if (asset.data) {
    const a = asset.data;
    sections.push(
      `Asset metadata:\n` +
        `  tradable=${a.tradable}  shortable=${a.shortable}  easyToBorrow=${a.easyToBorrow}\n` +
        `  marginable=${a.marginable}  fractionable=${a.fractionable}\n` +
        `  status=${a.status}  class=${a.assetClass}`,
    );
  } else {
    sections.push('Asset metadata: unavailable (feed errored)');
  }

  const errored = [quote, asset].filter((r) => r.errored).length;
  if (errored > 0) sections.push(`Feed errors: ${errored} source(s) returned empty or errored.`);

  return {
    contextBlock: sections.length
      ? `--- LIQUIDITY & SLIPPAGE FEEDS ---\n${sections.join('\n\n')}`
      : `--- LIQUIDITY & SLIPPAGE FEEDS ---\n(no data — operating in no-feed mode)`,
    feedFetchIds: ids,
  };
}
