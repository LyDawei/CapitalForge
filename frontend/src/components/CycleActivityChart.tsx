import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { CycleRow } from '../api/hooks';

interface Props {
  cycles: CycleRow[];
}

export default function CycleActivityChart({ cycles }: Props) {
  if (cycles.length === 0) {
    return <div className="empty">No cycles yet.</div>;
  }

  const byDay = new Map<string, { buy: number; sell: number; other: number }>();
  for (const c of cycles) {
    const bucket = byDay.get(c.date) ?? { buy: 0, sell: 0, other: 0 };
    const action = c.tradePlan?.action;
    if (action === 'BUY') bucket.buy += 1;
    else if (action === 'SELL') bucket.sell += 1;
    else bucket.other += 1;
    byDay.set(c.date, bucket);
  }

  const data = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, b]) => ({ date, BUY: b.buy, SELL: -b.sell, other: b.other }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#2a2f42" />
        <XAxis dataKey="date" stroke="#8b96b0" minTickGap={30} />
        <YAxis stroke="#8b96b0" tickFormatter={(v: number) => `${Math.abs(v)}`} allowDecimals={false} />
        <ReferenceLine y={0} stroke="#2a2f42" />
        <Tooltip
          contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
          labelStyle={{ color: '#d6deeb' }}
          itemStyle={{ color: '#d6deeb' }}
          formatter={(v: number, name: string) => [Math.abs(v), name]}
          labelFormatter={(label: string, payload) => {
            const other = (payload?.[0]?.payload as { other?: number } | undefined)?.other ?? 0;
            return other > 0 ? `${label} (+${other} hold/other)` : label;
          }}
        />
        <Legend />
        <Bar dataKey="BUY" fill="#3987e5" name="BUY" isAnimationActive={false} />
        <Bar dataKey="SELL" fill="#e66767" name="SELL" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
