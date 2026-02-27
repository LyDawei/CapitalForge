import Link from 'next/link';
import { getLatestPortfolioState, getRecentCycles, getEquityCurve } from '@/lib/queries';
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils';
import { EquityPoint } from '@/lib/types';
import Card from '@/components/ui/Card';
import { DecisionBadge, StatusBadge } from '@/components/ui/Badge';
import EquityCurve from '@/components/charts/EquityCurve';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [portfolio, recentCycles, equityData] = await Promise.all([
    getLatestPortfolioState(),
    getRecentCycles(10),
    getEquityCurve(),
  ]);

  const chartData: EquityPoint[] = equityData.map((s) => ({
    date: s.date,
    equity: s.currentEquity,
    cash: s.cashBalance,
    drawdown: s.drawdownPct,
    positionSymbol: s.positionSymbol,
    positionQty: s.positionQty,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Dashboard</h1>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Equity"
          value={portfolio ? formatCurrency(portfolio.currentEquity) : '—'}
          subtext={portfolio ? `Peak: ${formatCurrency(portfolio.peakEquity)}` : undefined}
        />
        <MetricCard
          label="Cash Balance"
          value={portfolio ? formatCurrency(portfolio.cashBalance) : '—'}
          subtext={portfolio ? `of ${formatCurrency(portfolio.allocatedCapital)}` : undefined}
        />
        <MetricCard
          label="Drawdown"
          value={portfolio ? formatPercent(portfolio.drawdownPct) : '—'}
          color={portfolio && portfolio.drawdownPct > 0.1 ? 'text-red-400' : 'text-gray-200'}
        />
        <MetricCard
          label="Position"
          value={
            portfolio && portfolio.positionQty > 0
              ? `${portfolio.positionQty} ${portfolio.positionSymbol}`
              : 'Flat'
          }
          subtext={
            portfolio && portfolio.positionAvgPrice
              ? `Avg: ${formatCurrency(portfolio.positionAvgPrice)}`
              : undefined
          }
        />
      </div>

      {/* Equity Chart */}
      {chartData.length > 0 && (
        <Card title="Equity Curve">
          <EquityCurve data={chartData} height={250} />
        </Card>
      )}

      {/* Recent Cycles */}
      <Card title="Recent Cycles">
        {recentCycles.length === 0 ? (
          <p className="text-gray-500 text-sm">No cycles yet. Run a trading cycle to see data here.</p>
        ) : (
          <div className="space-y-2">
            {recentCycles.map((cycle) => (
              <Link
                key={cycle.id}
                href={`/cycles/${cycle.id}`}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-800/50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">{formatDate(cycle.date)}</span>
                  <span className="text-sm font-medium text-gray-200">{cycle.symbol}</span>
                  {cycle.decision && <DecisionBadge decision={cycle.decision.decision} />}
                </div>
                <div className="flex items-center gap-3">
                  {cycle.trade && (
                    <span className={`text-xs ${
                      cycle.trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {cycle.trade.side.toUpperCase()} {cycle.trade.quantity}
                      {cycle.trade.filledPrice ? ` @ ${formatCurrency(cycle.trade.filledPrice)}` : ''}
                    </span>
                  )}
                  <StatusBadge status={cycle.status} />
                  <span className="text-gray-600 group-hover:text-gray-400 transition-colors">&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {recentCycles.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <Link href="/cycles" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              View all cycles &rarr;
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  color = 'text-gray-200',
}: {
  label: string;
  value: string;
  subtext?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-600 mt-0.5">{subtext}</div>}
    </div>
  );
}
