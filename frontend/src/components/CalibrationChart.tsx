import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { Calibration } from '../api/hooks';

interface Props {
  data: Calibration;
}

export default function CalibrationChart({ data }: Props) {
  const points = data.buckets
    .filter((b) => b.observedWinRate !== null && b.count > 0)
    .map((b) => ({ stated: b.meanConfidence, observed: b.observedWinRate!, count: b.count }));

  if (points.length === 0) {
    return <div className="empty">No closed trades yet — calibration needs realized outcomes.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 16, right: 16, bottom: 32, left: 32 }}>
        <CartesianGrid stroke="#2a2f42" />
        <XAxis type="number" dataKey="stated" domain={[0, 1]} stroke="#8b96b0" label={{ value: 'Stated confidence', position: 'bottom', fill: '#8b96b0' }} />
        <YAxis type="number" dataKey="observed" domain={[0, 1]} stroke="#8b96b0" label={{ value: 'Observed win rate', angle: -90, position: 'left', fill: '#8b96b0' }} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#7fc8a9" strokeDasharray="4 4" />
        <Tooltip
          contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
          formatter={(v: number, name: string) => [v.toFixed(2), name === 'observed' ? 'Observed' : 'Stated']}
        />
        <Scatter data={points} fill="#6dbbe7" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
