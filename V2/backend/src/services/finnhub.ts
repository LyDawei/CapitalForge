/**
 * Finnhub adapter. Free tier (60 req/min) gives us:
 *   - getEarningsCalendar  → forcedHoldRecommended driver for newsEvents
 *   - getCompanyNews       → per-symbol headlines with sentiment
 *   - getEconomicCalendar  → macro release impact for both agents
 *
 * Token-bucket rate limiter mirrors the Alpaca adapter pattern. Falls back
 * to a deterministic mock when FINNHUB_API_KEY is empty so the dev loop
 * never blocks.
 *
 * Sign up: https://finnhub.io/dashboard
 */
import { fetchWithAudit, type FetchWithAuditResult } from './feedLog';

// ---------------------------------------------------------------------------
// Public types — what the agents see. Intentionally a subset of the upstream
// Finnhub shapes; we drop fields the agents don't read so the audit payload
// stays small and the prompt rendering stays predictable.
// ---------------------------------------------------------------------------
export interface CompanyNewsItem {
  /// Article ID from Finnhub. Use as a stable key in the UI.
  id: number;
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // unix seconds
}

export interface EarningsEvent {
  symbol: string;
  /// Earnings date in YYYY-MM-DD.
  date: string;
  /// 'bmo' = before market open, 'amc' = after market close, '' = unknown.
  hour: 'bmo' | 'amc' | '' | string;
  epsEstimate?: number | null;
  revenueEstimate?: number | null;
}

export interface EconomicEvent {
  /// Event name (e.g., "CPI YoY", "Non-Farm Payrolls").
  event: string;
  country: string;
  /// ISO timestamp.
  time: string;
  /// 'low' | 'medium' | 'high' as reported by Finnhub.
  impact: 'low' | 'medium' | 'high' | string;
  actual?: number | null;
  estimate?: number | null;
  previous?: number | null;
}

export interface FinnhubService {
  getCompanyNews(
    symbol: string,
    daysBack: number,
  ): Promise<FetchWithAuditResult<CompanyNewsItem[]>>;
  getEarningsCalendar(
    symbol: string,
    daysAhead: number,
  ): Promise<FetchWithAuditResult<EarningsEvent[]>>;
  getEconomicCalendar(daysAhead: number): Promise<FetchWithAuditResult<EconomicEvent[]>>;
}

// ---------------------------------------------------------------------------
// Token bucket — same pattern as alpaca.real.ts. Free tier is 60/min;
// FINNHUB_RATE_LIMIT_PER_MIN defaults to 50 to leave headroom.
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
// Real adapter
// ---------------------------------------------------------------------------
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

class RealFinnhubService implements FinnhubService {
  private readonly bucket: TokenBucket;

  constructor(private apiKey: string, rateLimitPerMin: number) {
    this.bucket = new TokenBucket(rateLimitPerMin);
  }

  async getCompanyNews(symbol: string, daysBack: number) {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - daysBack);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${ymd(from)}&to=${ymd(to)}&token=${this.apiKey}`;
    return fetchWithAudit<CompanyNewsItem[]>({
      source: 'finnhub_company_news',
      symbol,
      url,
      fetcher: async () => {
        await this.bucket.take();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Finnhub ${res.status}: ${await res.text().catch(() => '')}`);
        const raw = (await res.json()) as any[];
        return (raw ?? []).slice(0, 50).map((a) => ({
          id: a.id,
          symbol,
          headline: a.headline,
          summary: a.summary,
          source: a.source,
          url: a.url,
          datetime: a.datetime,
        }));
      },
    });
  }

  async getEarningsCalendar(symbol: string, daysAhead: number) {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + daysAhead);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${ymd(from)}&to=${ymd(to)}&symbol=${symbol}&token=${this.apiKey}`;
    return fetchWithAudit<EarningsEvent[]>({
      source: 'finnhub_earnings',
      symbol,
      url,
      fetcher: async () => {
        await this.bucket.take();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Finnhub ${res.status}: ${await res.text().catch(() => '')}`);
        const data = (await res.json()) as { earningsCalendar?: any[] };
        return (data.earningsCalendar ?? []).map((e) => ({
          symbol: e.symbol,
          date: e.date,
          hour: e.hour ?? '',
          epsEstimate: e.epsEstimate ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
        }));
      },
    });
  }

  async getEconomicCalendar(daysAhead: number) {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + daysAhead);
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${ymd(from)}&to=${ymd(to)}&token=${this.apiKey}`;
    return fetchWithAudit<EconomicEvent[]>({
      source: 'finnhub_economic_calendar',
      url,
      fetcher: async () => {
        await this.bucket.take();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Finnhub ${res.status}: ${await res.text().catch(() => '')}`);
        const data = (await res.json()) as { economicCalendar?: any[] };
        // Filter to US + high-impact to keep payload tight; agent doesn't need
        // the firehose. Other countries' macro mostly correlates anyway.
        return (data.economicCalendar ?? [])
          .filter((e) => e.country === 'US' && (e.impact === 'high' || e.impact === 'medium'))
          .map((e) => ({
            event: e.event,
            country: e.country,
            time: e.time,
            impact: e.impact,
            actual: e.actual ?? null,
            estimate: e.estimate ?? null,
            previous: e.prev ?? null,
          }));
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Mock — deterministic-ish; designed so the agents have varied + interpretable
// data to reason about during dev. Earnings inside-window cycles deliberately
// to exercise the forcedHoldRecommended path.
// ---------------------------------------------------------------------------
class MockFinnhubService implements FinnhubService {
  async getCompanyNews(symbol: string, daysBack: number) {
    return fetchWithAudit<CompanyNewsItem[]>({
      source: 'finnhub_company_news',
      symbol,
      url: `mock://finnhub/company-news/${symbol}`,
      fetcher: async () => {
        // 2-4 deterministic headlines per call.
        const now = Math.floor(Date.now() / 1000);
        const seed = hashString(symbol + daysBack);
        const headlines = [
          `${symbol} announces partnership with major cloud provider`,
          `Analysts upgrade ${symbol} price target citing operational leverage`,
          `${symbol} insider buying reported in SEC filing`,
          `Sector rotation lifts ${symbol} above key technical level`,
        ];
        const sources = ['Reuters', 'Bloomberg', 'WSJ', 'CNBC'];
        const count = 2 + (seed % 3);
        return headlines.slice(0, count).map((h, i) => ({
          id: seed + i,
          symbol,
          headline: h,
          summary: `${h}. Details forthcoming.`,
          source: sources[(seed + i) % sources.length]!,
          url: `mock://finnhub/article/${seed + i}`,
          datetime: now - (i + 1) * 86400,
        }));
      },
    });
  }

  async getEarningsCalendar(symbol: string, daysAhead: number) {
    return fetchWithAudit<EarningsEvent[]>({
      source: 'finnhub_earnings',
      symbol,
      url: `mock://finnhub/earnings/${symbol}`,
      fetcher: async () => {
        // Deterministic: roughly 1 in 5 days has earnings in the window.
        // Keeps newsEvents' forcedHoldRecommended path exercised in dev.
        const seed = hashString(symbol);
        if (seed % 5 !== 0) return [];
        const daysOut = 1 + (seed % Math.max(daysAhead, 1));
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + daysOut);
        return [
          {
            symbol,
            date: d.toISOString().slice(0, 10),
            hour: seed % 2 === 0 ? 'bmo' : 'amc',
            epsEstimate: +(0.5 + (seed % 50) / 10).toFixed(2),
            revenueEstimate: null,
          },
        ];
      },
    });
  }

  async getEconomicCalendar(daysAhead: number) {
    return fetchWithAudit<EconomicEvent[]>({
      source: 'finnhub_economic_calendar',
      url: `mock://finnhub/economic-calendar`,
      fetcher: async () => {
        const seed = hashString(`econ-${daysAhead}`);
        if (seed % 3 === 0) return []; // sometimes nothing imminent
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + 1 + (seed % 5));
        return [
          {
            event: 'CPI YoY',
            country: 'US',
            time: d.toISOString(),
            impact: 'high',
            actual: null,
            estimate: 3.0,
            previous: 3.1,
          },
        ];
      },
    });
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let _instance: FinnhubService | null = null;

export function getFinnhubService(): FinnhubService {
  if (_instance) return _instance;
  const apiKey = process.env.FINNHUB_API_KEY ?? '';
  const rateLimit = Number(process.env.FINNHUB_RATE_LIMIT_PER_MIN ?? '50');
  _instance = apiKey ? new RealFinnhubService(apiKey, rateLimit) : new MockFinnhubService();
  return _instance;
}

export function _resetFinnhubServiceForTests() {
  _instance = null;
}
