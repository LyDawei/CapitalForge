/**
 * Real Alpaca market-data adapter — TODO.md item #3 Phase A.
 *
 * Phase B (order execution) is intentionally NOT implemented here. The audit
 * console writes proposed TradePlans but does not move money. When V2 is
 * ready to arm trading, add `submitOrder` behind a `RUNNER_DRY_RUN` env gate
 * and copy the order/position calls from `packages/engine/src/services/alpaca.ts`.
 *
 * What this does cover:
 *   - getDailyBars / getBarsAfter with `next_page_token` pagination
 *   - getCurrentPrice: latest trade → fallback to latest bar
 *   - Simple in-process token-bucket rate limiter (free tier is 200/min)
 *   - 401 fails loud, 429 backs off and retries, 5xx retries up to 3x
 *   - All bars normalized to the V2 DailyBar shape (date = YYYY-MM-DD)
 */
import type { AlpacaService, DailyBar } from './alpaca';

interface AlpacaBarResponse {
  bars?: Array<{
    t: string; // ISO timestamp
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
  next_page_token?: string | null;
}

interface AlpacaLatestTradeResponse {
  trade?: {
    p: number; // price
    s: number; // size
    t: string;
  };
}

// ---------------------------------------------------------------------------
// Token bucket — simple per-second admission control.
// Sized for ~3 requests/sec ≈ 180/min by default.
// ---------------------------------------------------------------------------
class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private last: number;

  constructor(perMinute: number) {
    this.capacity = perMinute;
    this.tokens = perMinute;
    this.refillPerMs = perMinute / 60_000;
    this.last = Date.now();
  }

  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.last;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = now;
  }
}


// ---------------------------------------------------------------------------
// Bar mapping. Alpaca's `t` is an ISO timestamp; V2 stores YYYY-MM-DD dates so
// indicator math operates on calendar bars regardless of intraday timestamps.
// ---------------------------------------------------------------------------
function toDailyBar(b: { t: string; o: number; h: number; l: number; c: number; v: number }): DailyBar {
  return {
    date: b.t.slice(0, 10),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  };
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------
export interface RealAlpacaOptions {
  apiKey: string;
  apiSecret: string;
  dataBaseUrl: string;
  feed: string;
  rateLimitPerMin: number;
}

export class RealAlpacaService implements AlpacaService {
  private readonly headers: Record<string, string>;
  private readonly dataBaseUrl: string;
  private readonly feed: string;
  private readonly limiter: TokenBucket;

  constructor(opts: RealAlpacaOptions) {
    this.headers = {
      'APCA-API-KEY-ID': opts.apiKey,
      'APCA-API-SECRET-KEY': opts.apiSecret,
      'Content-Type': 'application/json',
    };
    this.dataBaseUrl = opts.dataBaseUrl;
    this.feed = opts.feed;
    this.limiter = new TokenBucket(opts.rateLimitPerMin);
  }

  async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
    // The bars endpoint returns oldest-first within the requested window.
    // Walk back ~2× as many calendar days as we want trading days to absorb
    // weekends and holidays — same pattern the mock uses.
    const end = lastWeekday(new Date());
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - Math.ceil(limit * 1.6) - 10);
    return this.fetchBars(symbol, ymd(start), ymd(end), limit);
  }

  async getBarsAfter(symbol: string, afterDate: string, count: number): Promise<DailyBar[]> {
    // Strictly AFTER the cycle date — start one day past it.
    const start = new Date(afterDate);
    start.setUTCDate(start.getUTCDate() + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + Math.ceil(count * 1.6) + 10);
    return this.fetchBars(symbol, ymd(start), ymd(end), count);
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    // Prefer latest trade. On the free IEX-only tier this is roughly real-time
    // for IEX-routed trades; for other venues there's some lag. If the trades
    // endpoint returns nothing usable, fall back to the most recent daily bar.
    try {
      const url = `${this.dataBaseUrl}/v2/stocks/${symbol}/trades/latest?feed=${this.feed}`;
      const data = await this.request<AlpacaLatestTradeResponse>(url);
      if (data.trade && typeof data.trade.p === 'number') return data.trade.p;
    } catch (e) {
      // Fall through to bar fallback rather than fail the whole cycle on an
      // intermittent latest-trade outage.
    }
    const bars = await this.getDailyBars(symbol, 1);
    if (bars.length === 0) {
      throw new Error(`No price data available for ${symbol}`);
    }
    return bars[bars.length - 1]!.close;
  }

  /**
   * Internal: paginated bars fetch in [start, end], normalized + length-capped.
   */
  private async fetchBars(
    symbol: string,
    start: string,
    end: string,
    limit: number,
  ): Promise<DailyBar[]> {
    const all: DailyBar[] = [];
    // The page-size cap on Alpaca's bars endpoint is 10000. We pick min(limit, 1000)
    // per page; that's plenty for daily history and keeps the response small.
    const pageSize = Math.min(Math.max(limit, 1), 1000);
    let pageToken: string | null | undefined;

    do {
      const params = new URLSearchParams({
        start,
        end,
        timeframe: '1Day',
        limit: pageSize.toString(),
        feed: this.feed,
      });
      if (pageToken) params.set('page_token', pageToken);

      const url = `${this.dataBaseUrl}/v2/stocks/${symbol}/bars?${params}`;
      const data = await this.request<AlpacaBarResponse>(url);
      for (const b of data.bars ?? []) all.push(toDailyBar(b));
      pageToken = data.next_page_token ?? null;
    } while (pageToken && all.length < limit);

    // Endpoint returns oldest-first. Trim from the END so we keep the most
    // recent `limit` bars, matching what indicators expect.
    if (all.length > limit) return all.slice(all.length - limit);
    return all;
  }

  /**
   * Single HTTP call with rate limiting + retry. Pulled into one place so
   * every Alpaca request shares the same backoff + error-handling behavior.
   */
  private async request<T>(url: string, attempt = 0): Promise<T> {
    await this.limiter.take();
    const res = await fetch(url, { method: 'GET', headers: this.headers });
    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => '');

    if (res.status === 401) {
      // Credential failure should never silently retry — surface immediately.
      throw new Error(`Alpaca 401: bad APCA credentials. ${body}`);
    }
    if (res.status === 429 && attempt < 4) {
      // Exponential backoff: 500ms, 1s, 2s, 4s
      const wait = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(url, attempt + 1);
    }
    if (res.status >= 500 && attempt < 3) {
      const wait = 250 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(url, attempt + 1);
    }
    throw new Error(`Alpaca API error ${res.status}: ${body || res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastWeekday(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - 1); // never request "today" — bars aren't closed yet
  while (out.getUTCDay() === 0 || out.getUTCDay() === 6) {
    out.setUTCDate(out.getUTCDate() - 1);
  }
  return out;
}
