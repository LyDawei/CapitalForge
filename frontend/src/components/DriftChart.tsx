import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { DriftSeries } from '../api/hooks';
import { pct } from '../lib/format';

interface Props {
  series: DriftSeries[];
}

// Fixed categorical order, never cycled — validated against the panel
// surface (#131722). Capped at 4 slots; older versions past the cap fold
// into the Prompts tab rather than generating a 5th ad-hoc hue.
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const MAX_SERIES = 4;

export default function DriftChart({ series }: Props) {
  if (series.length === 0) {
    return <div className="empty">Not enough settled trades yet.</div>;
  }

  const shown = series.slice(-MAX_SERIES);
  const hidden = series.length - shown.length;

  // Merge all series' points into one array keyed by date, one column per version.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of shown) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.version] = p.hitRate;
      byDate.set(p.date, row);
    }
  }
  const data = Array.from(byDate.values()).sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1));

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#2a2f42" />
          <XAxis dataKey="date" stroke="#8b96b0" minTickGap={30} />
          <YAxis domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} stroke="#8b96b0" />
          <Tooltip
            contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
            labelStyle={{ color: '#d6deeb' }}
            itemStyle={{ color: '#d6deeb' }}
            formatter={(v: number, name: string) => [pct(v), `v${name}`]}
          />
          {shown.length > 1 && <Legend formatter={(v: string) => `v${v}`} />}
          {shown.map((s, i) => (
            <Line
              key={s.promptVersionId}
              type="monotone"
              dataKey={s.version}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {hidden > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
          {hidden} older prompt version(s) not shown — see the Prompts tab for full history.
        </p>
      )}
    </div>
  );
}
