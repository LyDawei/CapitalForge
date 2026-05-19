interface Props {
  label: string;
  value: string;
  sub?: string;
}

export default function MetricCard({ label, value, sub }: Props) {
  return (
    <div className="card metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
