import { env } from '../env';

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlpacaService {
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  getCurrentPrice(symbol: string): Promise<number>;
  /** Bars strictly AFTER the given date — used by trade-outcome settler. */
  getBarsAfter(symbol: string, afterDate: string, count: number): Promise<DailyBar[]>;
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
  if (env.MODE === 'mock' || !env.ALPACA_API_KEY) {
    _instance = new MockAlpacaService();
  } else {
    // Real adapter goes in services/alpaca.real.ts when we're ready.
    _instance = new MockAlpacaService();
  }
  return _instance;
}
