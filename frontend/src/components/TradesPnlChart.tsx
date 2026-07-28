import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { usd } from '../lib/format';

export interface PnlTrade {
  cycle: { date: string } | null;
  createdAt: string;
  outcome: { realizedPnl: number } | null;
}

interface Props {
  trades: PnlTrade[];
}

export default function TradesPnlChart({ trades }: Props) {
  const closed = trades
    .filter((t) => t.outcome !== null)
    .slice()
    .sort((a, b) => {
      const da = a.cycle?.date ?? a.createdAt;
      const db = b.cycle?.date ?? b.createdAt;
      return da < db ? -1 : da > db ? 1 : 0;
    });

  if (closed.length === 0) {
    return <div className="empty">No settled trades yet.</div>;
  }

  let cumulative = 0;
  const data = closed.map((t) => {
    cumulative += t.outcome!.realizedPnl;
    return { date: t.cycle?.date ?? t.createdAt, cumulativePnl: cumulative };
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#2a2f42" />
        <XAxis dataKey="date" stroke="#8b96b0" minTickGap={30} />
        <YAxis stroke="#8b96b0" tickFormatter={(v: number) => usd(v, 0)} width={70} />
        <ReferenceLine y={0} stroke="#2a2f42" />
        <Tooltip
          contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
          labelStyle={{ color: '#d6deeb' }}
          itemStyle={{ color: '#d6deeb' }}
          formatter={(v: number) => [usd(v, 2), 'Cumulative P&L']}
        />
        <Line type="monotone" dataKey="cumulativePnl" stroke="#6dbbe7" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
