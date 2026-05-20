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

export interface AlpacaService {
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  getCurrentPrice(symbol: string): Promise<number>;
  /** Bars strictly AFTER the given date — used by trade-outcome settler. */
  getBarsAfter(symbol: string, afterDate: string, count: number): Promise<DailyBar[]>;
  /**
   * Recent news for a symbol, with audit-trail metadata wrapper. Up to
   * `daysBack` days of articles (capped at the Alpaca free tier's effective
   * limit of ~50 per response).
   */
  getNews(
    symbol: string,
    daysBack: number,
  ): Promise<FetchWithAuditResult<AlpacaNewsArticle[]>>;
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
