/**
 * FRED (St. Louis Fed) economic-data adapter.
 *
 * Why FRED for macroContext:
 *   - Free, registration only — no paid tier required.
 *   - Authoritative US macro series. Never deprecated.
 *   - Stable schema; same JSON shape across decades.
 *   - 120-request-per-minute soft cap; we stay well under.
 *
 * Series we currently pull:
 *   DGS10    — 10-Year Treasury Constant Maturity Rate (daily, percent)
 *   VIXCLS   — CBOE Volatility Index VIX (daily, level)
 *   DTWEXBGS — Nominal Broad U.S. Dollar Index (daily, index)
 *
 * The factory returns a deterministic mock when FRED_API_KEY is empty so the
 * dev loop never blocks on missing creds.
 */
import { fetchWithAudit, type FetchWithAuditResult } from './feedLog';

export interface FredObservation {
  date: string; // YYYY-MM-DD
  value: number | null; // FRED returns "." for missing; we map to null
}

export interface FredService {
  /// Most recent N observations, newest first.
  getRecent(seriesId: string, limit: number): Promise<FetchWithAuditResult<FredObservation[]>>;
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------
class RealFredService implements FredService {
  constructor(private apiKey: string) {}

  async getRecent(seriesId: string, limit: number): Promise<FetchWithAuditResult<FredObservation[]>> {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
      seriesId,
    )}&api_key=${this.apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
    return fetchWithAudit<FredObservation[]>({
      source: `fred_${seriesId.toLowerCase()}`,
      url,
      fetcher: async () => {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`FRED ${res.status}: ${body || res.statusText}`);
        }
        const data = (await res.json()) as { observations?: Array<{ date: string; value: string }> };
        return (data.observations ?? []).map((o) => ({
          date: o.date,
          // FRED encodes missing as ".". Normalize to null.
          value: o.value === '.' ? null : Number(o.value),
        }));
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Mock — deterministic, sufficient for dev + tests. The agent reads only the
// most recent + the direction (compares observations[0] to observations[1]),
// so we synthesize 7 days of slow drift per series.
// ---------------------------------------------------------------------------
class MockFredService implements FredService {
  async getRecent(seriesId: string, limit: number): Promise<FetchWithAuditResult<FredObservation[]>> {
    return fetchWithAudit<FredObservation[]>({
      source: `fred_${seriesId.toLowerCase()}`,
      url: `mock://fred/${seriesId}`,
      fetcher: async () => {
        const base = mockBaseFor(seriesId);
        const drift = mockDriftFor(seriesId);
        const today = new Date();
        const out: FredObservation[] = [];
        for (let i = 0; i < limit; i++) {
          const d = new Date(today);
          d.setUTCDate(today.getUTCDate() - i);
          if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
          out.push({
            date: d.toISOString().slice(0, 10),
            value: +(base - i * drift).toFixed(3),
          });
          if (out.length >= limit) break;
        }
        return out;
      },
    });
  }
}

function mockBaseFor(seriesId: string): number {
  switch (seriesId.toUpperCase()) {
    case 'DGS10':
      return 4.35; // 10Y yield ~4.35%
    case 'VIXCLS':
      return 16.5; // VIX low-volatility regime
    case 'DTWEXBGS':
      return 121.2; // Broad dollar index level
    default:
      return 100;
  }
}

function mockDriftFor(seriesId: string): number {
  switch (seriesId.toUpperCase()) {
    case 'DGS10':
      return 0.02;
    case 'VIXCLS':
      return 0.3;
    case 'DTWEXBGS':
      return 0.05;
    default:
      return 0.1;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let _instance: FredService | null = null;

export function getFredService(): FredService {
  if (_instance) return _instance;
  const apiKey = process.env.FRED_API_KEY ?? '';
  _instance = apiKey ? new RealFredService(apiKey) : new MockFredService();
  return _instance;
}

export function _resetFredServiceForTests() {
  _instance = null;
}
