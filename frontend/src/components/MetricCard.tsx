interface Props {
  label: React.ReactNode;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'danger';
}

const TONE_VAR: Record<NonNullable<Props['tone']>, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

export default function MetricCard({ label, value, sub, tone }: Props) {
  return (
    <div className="card metric">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: TONE_VAR[tone] } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
