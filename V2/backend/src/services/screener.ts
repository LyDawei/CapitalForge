/**
 * Quant pre-screener for the growthScout pipeline.
 *
 * Stage 1: enumerate US-equity universe via Alpaca /v2/assets (free, one call).
 * Stage 2: chunked bulk snapshots (~100 symbols per call) → compute ADV proxy.
 * Stage 3: filter ADV > $50M, exclude already-watchlisted, exclude
 *          non-tradable/non-marginable symbols.
 * Stage 4: rank by simple single-day momentum (close vs prevClose).
 *          Returns top N (default 50).
 *
 * The LLM agent (growthScout) does qualitative evaluation downstream — this
 * screener is deterministic + cheap so we never burn LLM calls on names
 * that can't pass basic liquidity / tradability filters.
 */
import { getAlpacaService } from './alpaca';
import type { AlpacaAssetInfo, AlpacaSnapshot } from './alpaca';

export interface ScreenerCandidate {
  symbol: string;
  name?: string;
  exchange?: string;
  /// close × volume (single-day ADV proxy).
  dollarVolume: number;
  /// (close - prevClose) / prevClose. Single-day momentum.
  dailyReturn: number;
  lastClose: number;
  /// FeedFetch IDs that contributed to this candidate's snapshot — used by
  /// the scout to record consumption rows so the audit page can trace
  /// "which feeds drove the discovery."
  feedFetchIds: string[];
}

export interface ScreenerOptions {
  /// Minimum dollar-volume floor in millions. Default $50M.
  minDollarVolumeM?: number;
  /// Take top N by momentum. Default 50.
  topN?: number;
  /// Symbols already in the watchlist — these are excluded from the candidate set.
  excludeSymbols?: string[];
  /// Cap on universe enumeration. Default unlimited (~10k symbols).
  /// Lower in dev to keep iteration fast.
  universeCap?: number;
}

/**
 * Result of one screening run. Includes the FeedFetch ID for the assets-list
 * call too — the scout records consumption from this so we can answer
 * "which assets-list snapshot did the scout work from on date X?"
 */
export interface ScreenerResult {
  candidates: ScreenerCandidate[];
  assetsFeedFetchId: string | null;
  snapshotFeedFetchIds: string[];
  /// Total tradable universe size before filtering. Useful for audit.
  universeSize: number;
  /// Number of candidates after ADV + watchlist exclusion.
  passedFilter: number;
}

const SNAPSHOT_BATCH_SIZE = 100;

export async function runScreener(opts: ScreenerOptions = {}): Promise<ScreenerResult> {
  const alpaca = getAlpacaService();
  const minDollarVolume = (opts.minDollarVolumeM ?? 50) * 1_000_000;
  const topN = opts.topN ?? 50;
  const excludeSet = new Set((opts.excludeSymbols ?? []).map((s) => s.toUpperCase()));

  // 1) Universe enumeration.
  const assetsResult = await alpaca.listAssets({ status: 'active', assetClass: 'us_equity' });
  const allAssets: AlpacaAssetInfo[] = assetsResult.data ?? [];
  const universe = allAssets.filter(
    (a) => a.tradable && a.assetClass === 'us_equity' && !excludeSet.has(a.symbol),
  );
  const universeCapped = opts.universeCap ? universe.slice(0, opts.universeCap) : universe;

  // 2) Bulk snapshots in batches.
  const snapshotsBySymbol = new Map<string, AlpacaSnapshot>();
  const snapshotFeedFetchIds: string[] = [];
  for (let i = 0; i < universeCapped.length; i += SNAPSHOT_BATCH_SIZE) {
    const batch = universeCapped.slice(i, i + SNAPSHOT_BATCH_SIZE).map((a) => a.symbol);
    const snapResult = await alpaca.getSnapshots(batch);
    snapshotFeedFetchIds.push(snapResult.feedFetchId);
    for (const s of snapResult.data ?? []) {
      if (s.latestClose > 0 && s.latestVolume > 0) snapshotsBySymbol.set(s.symbol, s);
    }
  }

  // 3) Build candidate set with ADV filter.
  const passing: ScreenerCandidate[] = [];
  for (const asset of universeCapped) {
    const snap = snapshotsBySymbol.get(asset.symbol);
    if (!snap) continue;
    const dollarVolume = snap.latestClose * snap.latestVolume;
    if (dollarVolume < minDollarVolume) continue;
    const dailyReturn = snap.prevClose && snap.prevClose > 0
      ? (snap.latestClose - snap.prevClose) / snap.prevClose
      : 0;
    passing.push({
      symbol: asset.symbol,
      name: asset.name,
      exchange: asset.exchange,
      dollarVolume,
      dailyReturn,
      lastClose: snap.latestClose,
      // FeedFetch trace happens at the scout level — screener doesn't know
      // which batch this symbol came from cheaply; we hand off the entire
      // batch ID list as `snapshotFeedFetchIds` and the scout records
      // consumption against the agent run.
      feedFetchIds: [],
    });
  }

  // 4) Rank by single-day momentum, take top N.
  passing.sort((a, b) => b.dailyReturn - a.dailyReturn);
  const topCandidates = passing.slice(0, topN);

  return {
    candidates: topCandidates,
    assetsFeedFetchId: assetsResult.feedFetchId,
    snapshotFeedFetchIds,
    universeSize: universeCapped.length,
    passedFilter: passing.length,
  };
}
