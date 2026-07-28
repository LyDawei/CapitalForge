import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { StabilityPoint } from '../api/hooks';
import { num } from '../lib/format';

interface Props {
  points: StabilityPoint[];
  avgScoreStdev: number;
  avgConfidenceStdev: number;
}

export default function StabilityScatterChart({ points, avgScoreStdev, avgConfidenceStdev }: Props) {
  if (points.length === 0) {
    return <div className="empty">No replay groups yet — stability needs ≥ 2 runs on identical inputs.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 16, right: 16, bottom: 32, left: 32 }}>
        <CartesianGrid stroke="#2a2f42" />
        <XAxis
          type="number"
          dataKey="scoreStdev"
          stroke="#8b96b0"
          label={{ value: 'Score stdev', position: 'bottom', fill: '#8b96b0' }}
        />
        <YAxis
          type="number"
          dataKey="confidenceStdev"
          stroke="#8b96b0"
          label={{ value: 'Confidence stdev', angle: -90, position: 'left', fill: '#8b96b0' }}
        />
        <ReferenceLine x={avgScoreStdev} stroke="#8b96b0" strokeDasharray="4 4" />
        <ReferenceLine y={avgConfidenceStdev} stroke="#8b96b0" strokeDasharray="4 4" />
        <Tooltip
          contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
          labelStyle={{ color: '#d6deeb' }}
          itemStyle={{ color: '#d6deeb' }}
          formatter={(v: number, name: string) => [num(v, 3), name === 'scoreStdev' ? 'Score stdev' : 'Confidence stdev']}
        />
        <Scatter data={points} fill="#6dbbe7" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
