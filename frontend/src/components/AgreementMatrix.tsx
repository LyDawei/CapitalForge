import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { AgreementMatrix } from '../api/hooks';

interface Props {
  data: AgreementMatrix;
  compact?: boolean;
}

// Sequential blue ramp (magnitude, not polarity — agreement is a 0-100%
// redundancy measure, not a good/bad judgment). Dark-mode anchor flipped so
// low agreement recedes toward the panel surface and high agreement pops.
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [24, 79, 149]], // #184f95
  [0.5, [57, 135, 229]], // #3987e5
  [1, [183, 211, 246]], // #b7d3f6
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function rampColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [t0, c0] = RAMP[i]!;
    const [t1, c1] = RAMP[i + 1]!;
    if (clamped >= t0 && clamped <= t1) {
      const localT = (clamped - t0) / (t1 - t0);
      return [
        Math.round(lerp(c0[0], c1[0], localT)),
        Math.round(lerp(c0[1], c1[1], localT)),
        Math.round(lerp(c0[2], c1[2], localT)),
      ];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}

function colorFor(agreement: number, sampleSize: number): string {
  if (sampleSize === 0) return '#1c2030';
  const [r, g, b] = rampColor(agreement);
  return `rgb(${r}, ${g}, ${b})`;
}

function ScaleLegend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
      <span>0%</span>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(to right, ${colorFor(0, 1)}, ${colorFor(0.5, 1)}, ${colorFor(1, 1)})`,
        }}
      />
      <span>100%</span>
    </div>
  );
}

export default function AgreementMatrix({ data, compact = false }: Props) {
  if (data.names.length === 0) return <div className="empty">No specialist analyses yet.</div>;

  const names = compact && data.names.length > 6
    ? topBySampleSize(data, 6)
    : data.names;

  const cols = names.length + 1;
  return (
    <div>
      <div
        className="matrix"
        style={{
          gridTemplateColumns: `auto repeat(${cols - 1}, minmax(${compact ? 48 : 70}px, 1fr))`,
          fontSize: compact ? 10 : 11,
        }}
      >
        <div className="cell header" />
        {names.map((n) => (
          <div key={`h-${n}`} className="cell header" style={{ padding: compact ? 4 : 8 }}>{n}</div>
        ))}
        {names.map((row) => (
          <Fragment key={row}>
            <div className="cell header" style={{ padding: compact ? 4 : 8 }}>{row}</div>
            {names.map((col) => {
              const cell = data.matrix[row]?.[col] ?? { agreement: 0, sampleSize: 0 };
              return (
                <div
                  key={`${row}-${col}`}
                  className="cell"
                  style={{ background: colorFor(cell.agreement, cell.sampleSize), padding: compact ? 4 : 8 }}
                  title={`${cell.sampleSize} samples`}
                >
                  {cell.sampleSize > 0 ? `${(cell.agreement * 100).toFixed(0)}%` : '—'}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <ScaleLegend />
      {compact && data.names.length > 6 && (
        <p style={{ marginTop: 8 }}>
          <Link to="/audit">View full matrix ({data.names.length} specialists) →</Link>
        </p>
      )}
    </div>
  );
}

function topBySampleSize(data: AgreementMatrix, n: number): string[] {
  const totals = data.names.map((name) => {
    const total = data.names.reduce((acc, other) => acc + (data.matrix[name]?.[other]?.sampleSize ?? 0), 0);
    return { name, total };
  });
  return totals
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map((t) => t.name);
}
