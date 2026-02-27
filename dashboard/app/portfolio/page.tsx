import { getSandboxHistory } from '@/lib/queries';
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils';
import { EquityPoint } from '@/lib/types';
import Card from '@/components/ui/Card';
import EquityCurve from '@/components/charts/EquityCurve';
import DrawdownChart from '@/components/charts/DrawdownChart';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const snapshots = await getSandboxHistory();

  const chartData: EquityPoint[] = snapshots.map((s) => ({
    date: s.date,
    equity: s.currentEquity,
    cash: s.cashBalance,
    drawdown: s.drawdownPct,
    positionSymbol: s.positionSymbol,
    positionQty: s.positionQty,
  }));

  // Compute summary metrics
  const latest = snapshots[snapshots.length - 1];
  const first = snapshots[0];
  const maxDrawdown = snapshots.length > 0
    ? Math.max(...snapshots.map((s) => s.drawdownPct))
    : 0;
  const totalReturn = first && latest
    ? ((latest.currentEquity - first.allocatedCapital) / first.allocatedCapital)
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Portfolio History</h1>

      {snapshots.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12 bg-gray-900 rounded-lg border border-gray-800">
          No portfolio data yet. Run a trading cycle to see portfolio history.
        </div>
      ) : (
        <>
          {/* Summary Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Return"
              value={formatPercent(totalReturn)}
              color={totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <MetricCard
              label="Max Drawdown"
              value={formatPercent(maxDrawdown)}
              color={maxDrawdown > 0.1 ? 'text-red-400' : 'text-gray-200'}
            />
            <MetricCard
              label="Current Equity"
              value={latest ? formatCurrency(latest.currentEquity) : '—'}
            />
            <MetricCard
              label="Days Tracked"
              value={String(snapshots.length)}
            />
          </div>

          {/* Equity Curve */}
          <Card title="Equity Curve">
            <EquityCurve data={chartData} height={300} />
          </Card>

          {/* Drawdown Chart */}
          <Card title="Drawdown">
            <DrawdownChart data={chartData} height={200} />
          </Card>

          {/* Snapshot Table */}
          <Card title="Daily Snapshots">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Equity</th>
                    <th className="pb-2 pr-4">Cash</th>
                    <th className="pb-2 pr-4">Position</th>
                    <th className="pb-2">Drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snapshots].reverse().map((s) => (
                    <tr key={s.id} className="border-b border-gray-800/50">
                      <td className="py-2 pr-4 text-gray-300">{formatDate(s.date)}</td>
                      <td className="py-2 pr-4 font-mono text-gray-200">{formatCurrency(s.currentEquity)}</td>
                      <td className="py-2 pr-4 font-mono text-gray-400">{formatCurrency(s.cashBalance)}</td>
                      <td className="py-2 pr-4 text-gray-400">
                        {s.positionQty > 0 ? `${s.positionQty} ${s.positionSymbol}` : 'Flat'}
                      </td>
                      <td className={`py-2 font-mono ${s.drawdownPct > 0.1 ? 'text-red-400' : 'text-gray-400'}`}>
                        {formatPercent(s.drawdownPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  color = 'text-gray-200',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
    </div>
  );
}
