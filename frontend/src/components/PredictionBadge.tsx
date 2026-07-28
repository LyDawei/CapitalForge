import type { PredictionScore } from '../api/hooks';
import { pct } from '../lib/format';

export function PredictionBadge({ score }: { score: PredictionScore }) {
  if (score.sampleSize === 0) return <span className="badge">no data</span>;
  if (score.needsReview) {
    const variant = score.hitRate !== null && score.hitRate < 0.4 ? 'danger' : 'warn';
    return <span className={`badge ${variant}`}>needs review</span>;
  }
  if (score.hitRate !== null && score.hitRate >= 0.55) return <span className="badge ok">{pct(score.hitRate, 0)} hit</span>;
  return <span className="badge">{pct(score.hitRate, 0)} hit</span>;
}

export function PredictionInline({ score }: { score: PredictionScore }) {
  if (score.sampleSize === 0) return <span style={{ color: 'var(--text-dim)' }}>no samples yet</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <PredictionBadge score={score} />
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
        {score.sampleSize} samples
        {score.recentHitRate !== null && score.baselineHitRate !== null && (
          <>
            {' · '}recent {pct(score.recentHitRate, 0)} vs baseline {pct(score.baselineHitRate, 0)}
          </>
        )}
      </span>
    </span>
  );
}
