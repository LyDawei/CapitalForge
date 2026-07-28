import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import type { PredictionScore } from '../api/hooks';
import { pct } from '../lib/format';

interface Props {
  scores: PredictionScore[];
}

export default function PredictionHitRateChart({ scores }: Props) {
  const scored = scores.filter((s) => s.hitRate !== null);
  const unscored = scores.filter((s) => s.hitRate === null);

  if (scored.length === 0) {
    return <div className="empty">No agents with settled outcomes yet.</div>;
  }

  const data = scored
    .slice()
    .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0))
    .map((s) => ({ name: s.displayName, hitRate: s.hitRate!, needsReview: s.needsReview, sampleSize: s.sampleSize }));

  const height = Math.max(200, data.length * 32 + 40);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#2a2f42" horizontal={false} />
          <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} stroke="#8b96b0" />
          <YAxis type="category" dataKey="name" stroke="#8b96b0" width={140} />
          <Tooltip
            contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
            labelStyle={{ color: '#d6deeb' }}
            itemStyle={{ color: '#d6deeb' }}
            formatter={(v: number, _name: string, item: any) => [`${pct(v)} (n=${item.payload.sampleSize})`, 'Hit rate']}
          />
          <Bar dataKey="hitRate" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.needsReview ? '#f0c674' : '#7fc8a9'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#7fc8a9', marginRight: 6 }} />Healthy</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f0c674', marginRight: 6 }} />Needs review</span>
        {unscored.length > 0 && <span>{unscored.length} agent(s) with insufficient data not shown</span>}
      </div>
    </div>
  );
}
