import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { WalletTransaction } from '../api/hooks';
import { usd, dateTime } from '../lib/format';

interface Props {
  balance: number;
  transactions: WalletTransaction[];
}

export default function WalletBalanceChart({ balance, transactions }: Props) {
  if (transactions.length === 0) {
    return <div className="empty">No wallet activity yet.</div>;
  }

  // `transactions` is newest-first and `balance` is an exact SUM() over the
  // full ledger, so the balance-after-each-transaction can be reconstructed
  // backward from the current balance without needing the full history.
  let running = balance;
  const points: Array<{ createdAt: string; balance: number }> = [{ createdAt: transactions[0]!.createdAt, balance: running }];
  for (let i = 0; i < transactions.length - 1; i++) {
    running -= transactions[i]!.amount;
    points.push({ createdAt: transactions[i + 1]!.createdAt, balance: running });
  }
  points.reverse();

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={points} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#2a2f42" />
        <XAxis
          dataKey="createdAt"
          stroke="#8b96b0"
          tickFormatter={(v: string) => new Date(v).toLocaleDateString()}
          minTickGap={40}
        />
        <YAxis stroke="#8b96b0" tickFormatter={(v: number) => usd(v, 0)} width={70} />
        <Tooltip
          contentStyle={{ background: '#131722', border: '1px solid #2a2f42' }}
          labelStyle={{ color: '#d6deeb' }}
          itemStyle={{ color: '#d6deeb' }}
          labelFormatter={(v: string) => dateTime(v)}
          formatter={(v: number) => [usd(v, 2), 'Balance']}
        />
        <Line type="monotone" dataKey="balance" stroke="#6dbbe7" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
