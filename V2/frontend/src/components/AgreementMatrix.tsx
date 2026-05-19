import type { AgreementMatrix } from '../api/hooks';

interface Props { data: AgreementMatrix }

function colorFor(agreement: number, sampleSize: number): string {
  if (sampleSize === 0) return '#1c2030';
  // 1.0 = green, 0.5 = neutral, 0 = red
  const r = Math.round(239 - (239 - 127) * agreement);
  const g = Math.round(107 + (200 - 107) * agreement);
  const b = Math.round(115 + (169 - 115) * agreement);
  return `rgba(${r}, ${g}, ${b}, 0.35)`;
}

export default function AgreementMatrix({ data }: Props) {
  if (data.names.length === 0) return <div className="empty">No specialist analyses yet.</div>;
  const cols = data.names.length + 1;
  return (
    <div className="matrix" style={{ gridTemplateColumns: `auto repeat(${cols - 1}, minmax(70px, 1fr))` }}>
      <div className="cell header" />
      {data.names.map((n) => (
        <div key={`h-${n}`} className="cell header">{n}</div>
      ))}
      {data.names.map((row) => (
        <>
          <div key={`r-${row}`} className="cell header">{row}</div>
          {data.names.map((col) => {
            const cell = data.matrix[row]?.[col] ?? { agreement: 0, sampleSize: 0 };
            return (
              <div
                key={`${row}-${col}`}
                className="cell"
                style={{ background: colorFor(cell.agreement, cell.sampleSize) }}
                title={`${cell.sampleSize} samples`}
              >
                {cell.sampleSize > 0 ? `${(cell.agreement * 100).toFixed(0)}%` : '—'}
              </div>
            );
          })}
        </>
      ))}
    </div>
  );
}
