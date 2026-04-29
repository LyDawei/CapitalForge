import type { CSSProperties } from 'react';

const colors: Record<string, { bg: string; fg: string }> = {
  BUY: { bg: '#d1fae5', fg: '#065f46' },
  SELL: { bg: '#fee2e2', fg: '#991b1b' },
  CLOSE: { bg: '#fee2e2', fg: '#991b1b' },
  HOLD: { bg: '#e5e7eb', fg: '#374151' },
  completed: { bg: '#d1fae5', fg: '#065f46' },
  pending: { bg: '#fef3c7', fg: '#92400e' },
  failed: { bg: '#fee2e2', fg: '#991b1b' },
  proposed: { bg: '#dbeafe', fg: '#1e3a8a' },
  active: { bg: '#fde68a', fg: '#92400e' },
  closed: { bg: '#e5e7eb', fg: '#374151' },
  v1: { bg: '#f3e8ff', fg: '#6b21a8' },
  v2: { bg: '#dbeafe', fg: '#1e3a8a' },
  default: { bg: '#e5e7eb', fg: '#374151' },
};

export function Badge({ value }: { value: string | null | undefined }) {
  const key = (value ?? '').toString();
  const c = colors[key] ?? colors.default;
  const style: CSSProperties = {
    background: c.bg,
    color: c.fg,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.3,
    display: 'inline-block',
  };
  return <span style={style}>{value ?? '—'}</span>;
}

export function ScoreBadge({ score }: { score: number }) {
  const color = score > 0.4 ? '#065f46' : score < -0.4 ? '#991b1b' : '#374151';
  const bg = score > 0.4 ? '#d1fae5' : score < -0.4 ? '#fee2e2' : '#e5e7eb';
  return (
    <span
      style={{
        background: bg,
        color,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}
    >
      {score >= 0 ? '+' : ''}
      {score.toFixed(2)}
    </span>
  );
}
