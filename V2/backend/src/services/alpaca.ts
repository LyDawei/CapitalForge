import { env } from '../env';
import { fetchWithAudit, type FetchWithAuditResult } from './feedLog';

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlpacaNewsArticle {
  id: number;
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  createdAt: string; // ISO
}

/**
 * Compact NBBO quote snapshot. Fields beyond raw bid/ask are derived once at
 * fetch time so every consumer (audit page, agent prompt) sees the same
 * spread math.
 */
export interface AlpacaQuote {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number; // round-lot multiplier per Alpaca's `bs`
  askSize: number;
  midPrice: number;
  spreadAbs: number;
  spreadBps: number;
  /// ISO timestamp of the quote. On the IEX free tier this is ~15min delayed
  /// during market hours; the agent acknowledges that.
  timestamp: string;
  /// Seconds between `timestamp` and fetch time. Above ~900s = stale (the
  /// free tier delay floor) and the agent should treat sizing decisions with
  /// extra caution.
  quoteAgeSeconds: number;
}

/**
 * Asset metadata that drives execution sanity checks: can we trade it at all?
 * Is it short-able and how cheaply? Fractional shares allowed? Source:
 * `paper-api.alpaca.markets/v2/assets/{symbol}` (free tier).
 */
export interface AlpacaAssetInfo {
  symbol: string;
  tradable: boolean;
  shortable: boolean;
  easyToBorrow: boolean;
  marginable: boolean;
  fractionable: boolean;
  /// 'us_equity' | 'crypto' | etc.
  assetClass: string;
  /// Free-form per Alpaca: 'active' | 'inactive'
  status: string;
  /// Company name when available.
  name?: string;
  /// Exchange code (NASDAQ, NYSE, ARCA, etc.)
  exchange?: string;
}

/**
 * Lightweight per-symbol snapshot — what the screener pulls for many symbols
 * at once. Uses Alpaca's bulk-snapshots endpoint when real; mock generates
 * deterministic values.
 */
export interface AlpacaSnapshot {
  symbol: string;
  /// Latest daily bar.
  latestClose: number;
  latestVolume: number;
  latestBarDate: string; // YYYY-MM-DD
  /// Previous daily bar — lets the screener compute single-day momentum.
  prevClose?: number;
}

/**
 * Account snapshot from /v2/account. Read-only — V2 never writes to the
 * trading API (Phase B carve-out). Surfaces equity, cash, buying power,
 * and unrealized P&L so the dashboard can show "where the brokerage
 * account stands right now" alongside V2's internal wallet ledger.
 */
export interface AlpacaAccount {
  status: string;
  cash: number;
  equity: number;
  buyingPower: number;
  portfolioValue: number;
  longMarketValue: number;
  shortMarketValue: number;
  unrealizedPl: number;
  patternDayTrader: boolean;
  createdAt: string;
}

/**
 * Position snapshot from /v2/positions. Read-only.
 */
export interface AlpacaPosition {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
}

/**
 * Order snapshot from /v2/orders. Read-only. Mapped to V2 conventions.
 */
export interface AlpacaOrderSummary {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  filledQty: number;
  filledAvgPrice: number | null;
  status: string;
  createdAt: string;
  filledAt: string | null;
}

export interface AlpacaService {
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  getCurrentPrice(symbol: string): Promise<number>;
  /** Bars strictly AFTER the given date — used by trade-outcome settler. */
  getBarsAfter(symbol: string, afterDate: string, count: number): Promise<DailyBar[]>;
  /**
   * The most recent `limit` bars whose date is ≤ `beforeDate`. Powers
   * historical backfill — for a cycle dated 2026-01-15, the agent reads
   * bars from 2025-X..2026-01-15, NOT today's bars. When beforeDate is
   * today (or future), behavior is equivalent to getDailyBars.
   */
  getDailyBarsBefore(symbol: string, beforeDate: string, limit: number): Promise<DailyBar[]>;
  /**
   * Recent news for a symbol, with audit-trail metadata wrapper. Up to
   * `daysBack` days of articles (capped at the Alpaca free tier's effective
   * limit of ~50 per response).
   */
  getNews(
    symbol: string,
    daysBack: number,
  ): Promise<FetchWithAuditResult<AlpacaNewsArticle[]>>;
  /**
   * Most recent NBBO quote. On IEX free tier the quote is ~15min delayed
   * during market hours and reflects IEX-only liquidity — the
   * liquiditySlippage agent's prompt acknowledges this and weights the
   * signal accordingly.
   */
  getLatestQuote(symbol: string): Promise<FetchWithAuditResult<AlpacaQuote>>;
  /**
   * Static-ish asset metadata: tradable / shortable / easy-to-borrow /
   * marginable / fractionable. Used by liquiditySlippage to detect
   * mechanical un-tradability (delisted, non-shortable when SELL is intended,
   * etc.).
   */
  getAssetInfo(symbol: string): Promise<FetchWithAuditResult<AlpacaAssetInfo>>;
  /**
   * Enumerate the tradable US equity universe. Powers the growthScout
   * pipeline — ~10k symbols returned in one call (free tier). The optional
   * filters are applied client-side because Alpaca's endpoint is "all or
   * nothing" on these.
   */
  listAssets(filters?: { status?: 'active' | 'inactive'; assetClass?: string }): Promise<FetchWithAuditResult<AlpacaAssetInfo[]>>;
  /**
   * Bulk snapshot for many symbols. Alpaca's `/v2/stocks/snapshots` accepts
   * up to ~100 symbols per request. The screener batches large universes
   * through here so it only burns ~100 API calls to cover 10k names.
   */
  getSnapshots(symbols: string[]): Promise<FetchWithAuditResult<AlpacaSnapshot[]>>;
  /**
   * READ-ONLY brokerage account state — equity, cash, buying power, etc.
   * Surfaced on the dashboard so V2's internal wallet ledger and the actual
   * Alpaca paper-account state are both visible side-by-side. These reads
   * do NOT go through the FeedFetch audit table — they're dashboard data,
   * not agent inputs, so logging every UI refresh would just be noise.
   */
  getAccount(): Promise<AlpacaAccount>;
  /** READ-ONLY current open positions. */
  getPositions(): Promise<AlpacaPosition[]>;
  /** READ-ONLY recent orders, newest first. Default limit 20. */
  getRecentOrders(limit?: number): Promise<AlpacaOrderSummary[]>;
}

/**
 * Deterministic mock. Same inputs → same bars, so audit + replay are reproducible.
 */
class MockAlpacaService implements AlpacaService {
  async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
    return generateBars(symbol, new Date(), limit);
  }
  async getCurrentPrice(symbol: string): Promise<number> {
    return seededClose(symbol, new Date());
  }
  async getBarsAfter(symbol: string, afterDate: string, count: number): Promise<DailyBar[]> {
    const start = new Date(afterDate);
    start.setDate(start.getDate() + 1);
    return generateBars(symbol, start, count);
  }
  async getDailyBarsBefore(symbol: string, beforeDate: string, limit: number): Promise<DailyBar[]> {
    // Walk backward from beforeDate. The existing generateBars helper already
    // does this: it iterates backward from the anchor date, skipping weekends,
    // until it has `count` bars. For historical backfill that's exactly what
    // we want — anchor on the cycle date, accumulate trailing N bars.
    return generateBars(symbol, new Date(beforeDate), limit);
  }
  async getNews(symbol: string, daysBack: number) {
    return fetchWithAudit<AlpacaNewsArticle[]>({
      source: 'alpaca_news',
      symbol,
      url: `mock://alpaca/news/${symbol}`,
      fetcher: async () => {
        const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const count = 2 + (seed % 3);
        const now = new Date();
        const out: AlpacaNewsArticle[] = [];
        const corpus = [
          `${symbol} guidance raised after strong quarterly preprint`,
          `${symbol} broker initiation: Buy, $${100 + (seed % 50)} PT`,
          `${symbol} unusual options activity ahead of catalyst`,
          `Hedge fund 13F shows reduced ${symbol} position`,
        ];
        for (let i = 0; i < Math.min(count, daysBack); i++) {
          const d = new Date(now);
          d.setUTCDate(now.getUTCDate() - i);
          out.push({
            id: seed * 10 + i,
            symbol,
            headline: corpus[(seed + i) % corpus.length]!,
            summary: corpus[(seed + i) % corpus.length]!,
            source: 'mock',
            url: `mock://alpaca/article/${seed * 10 + i}`,
            createdAt: d.toISOString(),
          });
        }
        return out;
      },
    });
  }

  async getLatestQuote(symbol: string) {
    return fetchWithAudit<AlpacaQuote>({
      source: 'alpaca_quote',
      symbol,
      url: `mock://alpaca/quote/${symbol}`,
      fetcher: async () => {
        // Spread scales with price magnitude (a $10 stock has wider bps than
        // a $400 stock under the same penny tick). Sized to exercise the
        // agent's interpretation branches: most large caps land in "tight",
        // some test symbols land "wide" so the veto path fires in dev.
        const mid = seededClose(symbol, new Date());
        const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        // Spread = $0.01 baseline, scales up for low-priced / illiquid names.
        const spreadAbs = mid < 20 ? 0.02 + (seed % 5) * 0.005 : 0.01 + (seed % 3) * 0.002;
        const bid = +(mid - spreadAbs / 2).toFixed(2);
        const ask = +(mid + spreadAbs / 2).toFixed(2);
        const bidSize = 100 + (seed % 50) * 100;
        const askSize = 100 + ((seed + 7) % 50) * 100;
        const now = new Date();
        return {
          symbol,
          bid,
          ask,
          bidSize,
          askSize,
          midPrice: +mid.toFixed(2),
          spreadAbs: +spreadAbs.toFixed(4),
          spreadBps: +((spreadAbs / mid) * 10_000).toFixed(2),
          timestamp: now.toISOString(),
          quoteAgeSeconds: 0,
        };
      },
    });
  }

  async getAssetInfo(symbol: string) {
    return fetchWithAudit<AlpacaAssetInfo>({
      source: 'alpaca_asset_info',
      symbol,
      url: `mock://alpaca/assets/${symbol}`,
      fetcher: async () => {
        const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        // Most names tradable + shortable in the mock so the happy path
        // dominates; a few synthetic symbols flip to exercise the veto branch.
        return {
          symbol,
          tradable: true,
          shortable: seed % 7 !== 0,
          easyToBorrow: seed % 5 !== 0,
          marginable: true,
          fractionable: true,
          assetClass: 'us_equity',
          status: 'active',
          name: `${symbol} Inc.`,
          exchange: seed % 2 === 0 ? 'NASDAQ' : 'NYSE',
        };
      },
    });
  }

  async listAssets() {
    return fetchWithAudit<AlpacaAssetInfo[]>({
      source: 'alpaca_assets_list',
      url: `mock://alpaca/assets`,
      fetcher: async () => {
        // Synthetic universe: a curated set of well-known tickers plus a few
        // microcaps so the screener's ADV filter has signal to work with.
        const universe = [
          'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD',
          'AVGO', 'CRM', 'NFLX', 'INTC', 'CSCO', 'ORCL', 'IBM', 'QCOM',
          'JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA', 'AXP',
          'JNJ', 'UNH', 'PFE', 'MRK', 'ABBV', 'LLY', 'TMO', 'ABT',
          'XOM', 'CVX', 'COP', 'SLB',
          'PG', 'KO', 'PEP', 'WMT', 'COST', 'TGT',
          'BA', 'CAT', 'GE', 'HON',
          'DIS', 'NKE', 'SBUX',
          'PLTR', 'SNOW', 'NET', 'CRWD', 'ZS', 'DDOG', 'MDB',
          'COIN', 'HOOD', 'SOFI',
          'RIVN', 'LCID', 'NIO',
          'GME', 'AMC', // microcaps
        ];
        return universe.map((symbol, i) => ({
          symbol,
          tradable: true,
          shortable: i % 11 !== 0,
          easyToBorrow: i % 7 !== 0,
          marginable: true,
          fractionable: true,
          assetClass: 'us_equity',
          status: 'active',
          name: `${symbol} Inc.`,
          exchange: i % 2 === 0 ? 'NASDAQ' : 'NYSE',
        }));
      },
    });
  }

  async getSnapshots(symbols: string[]) {
    return fetchWithAudit<AlpacaSnapshot[]>({
      source: 'alpaca_snapshots',
      url: `mock://alpaca/snapshots`,
      fetcher: async () => {
        const today = new Date();
        return symbols.map((symbol) => {
          const close = seededClose(symbol, today);
          const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          // Volume scaled by symbol to ensure ADV varies across the universe —
          // some pass the $50M filter, some don't.
          const volumeBase = 500_000 + (seed * 137) % 50_000_000;
          return {
            symbol,
            latestClose: close,
            latestVolume: volumeBase,
            latestBarDate: today.toISOString().slice(0, 10),
            prevClose: +(close * (1 - ((seed % 10) - 5) / 1000)).toFixed(2),
          };
        });
      },
    });
  }

  // Account / positions / orders — mock returns synthetic data so the dev
  // dashboard has something to render before real keys are wired.
  async getAccount(): Promise<AlpacaAccount> {
    return {
      status: 'ACTIVE',
      cash: 100_000,
      equity: 100_000,
      buyingPower: 200_000,
      portfolioValue: 100_000,
      longMarketValue: 0,
      shortMarketValue: 0,
      unrealizedPl: 0,
      patternDayTrader: false,
      createdAt: new Date().toISOString(),
    };
  }
  async getPositions(): Promise<AlpacaPosition[]> {
    return [];
  }
  async getRecentOrders(): Promise<AlpacaOrderSummary[]> {
    return [];
  }
}

function seededClose(symbol: string, date: Date): number {
  const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + date.getUTCDate();
  const base = 50 + (seed % 200);
  const noise = ((seed * 9301 + 49297) % 233280) / 233280 - 0.5;
  return +(base + noise * 4).toFixed(2);
}

function generateBars(symbol: string, fromDate: Date, count: number): Promise<DailyBar[]> {
  const calendarDays = Math.ceil(count * 1.5) + 10;
  const bars: DailyBar[] = [];
  const cursor = new Date(fromDate);
  for (let i = 0; i < calendarDays && bars.length < count; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue; // skip weekends
    const close = seededClose(symbol, d);
    const high = close * 1.012;
    const low = close * 0.988;
    const open = close * (1 + (Math.random() - 0.5) * 0.005);
    const volume = 1_000_000 + Math.floor(Math.random() * 500_000);
    bars.unshift({ date: d.toISOString().slice(0, 10), open, high, low, close, volume });
  }
  return Promise.resolve(bars);
}

let _instance: AlpacaService | null = null;
export function getAlpacaService(): AlpacaService {
  if (_instance) return _instance;
  if (env.MODE === 'mock' || !env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) {
    _instance = new MockAlpacaService();
  } else {
    // Real adapter activates only when both MODE=paper AND credentials are
    // present. Missing creds silently fall back to mock so the dev loop never
    // crashes — but a misconfigured prod environment will see only mock data,
    // which is by design (loud failure on bad creds happens at first request).
    const { RealAlpacaService } = require('./alpaca.real') as typeof import('./alpaca.real');
    _instance = new RealAlpacaService({
      apiKey: env.ALPACA_API_KEY,
      apiSecret: env.ALPACA_API_SECRET,
      dataBaseUrl: env.ALPACA_DATA_URL,
      feed: env.ALPACA_DATA_FEED,
      rateLimitPerMin: env.ALPACA_RATE_LIMIT_PER_MIN,
    });
  }
  return _instance;
}

/** Test hook: reset the lazy singleton so tests can swap implementations. */
export function _resetAlpacaServiceForTests() {
  _instance = null;
}
