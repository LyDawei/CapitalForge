import Link from 'next/link';
import { Suspense } from 'react';
import { getCycles, getDistinctSymbols } from '@/lib/queries';
import { TechnicalData } from '@/lib/types';
import { formatCurrency, formatDate, formatScore, decisionColor } from '@/lib/utils';
import { DecisionBadge, StatusBadge } from '@/components/ui/Badge';
import CycleFilters from '@/components/cycles/CycleFilters';
import Pagination from '@/components/ui/Pagination';

interface PageProps {
  searchParams: Promise<{
    dateFrom?: string;
    dateTo?: string;
    symbol?: string;
    decision?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function CyclesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [symbols, result] = await Promise.all([
    getDistinctSymbols(),
    getCycles({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      symbol: params.symbol,
      decision: params.decision,
      status: params.status,
      page: params.page ? parseInt(params.page) : 1,
    }),
  ]);

  // Build base href for pagination (preserve current filters)
  const filterParams = new URLSearchParams();
  if (params.dateFrom) filterParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) filterParams.set('dateTo', params.dateTo);
  if (params.symbol) filterParams.set('symbol', params.symbol);
  if (params.decision) filterParams.set('decision', params.decision);
  if (params.status) filterParams.set('status', params.status);
  const baseHref = `/cycles${filterParams.toString() ? `?${filterParams.toString()}` : ''}`;

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-4">Cycle History</h1>

      <Suspense fallback={null}>
        <CycleFilters symbols={symbols} />
      </Suspense>

      <div className="text-xs text-gray-500 mb-3">
        {result.total} cycle{result.total !== 1 ? 's' : ''} found
      </div>

      {result.cycles.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12 bg-gray-900 rounded-lg border border-gray-800">
          No cycles found. Adjust your filters or run a trading cycle first.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">Close</th>
                <th className="pb-2 pr-4">Score</th>
                <th className="pb-2 pr-4">Decision</th>
                <th className="pb-2 pr-4">Risk</th>
                <th className="pb-2 pr-4">Trade</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.cycles.map((cycle) => {
                const tech = cycle.technicalData as unknown as TechnicalData;
                return (
                  <tr key={cycle.id} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                    <td className="py-2.5 pr-4">
                      <Link href={`/cycles/${cycle.id}`} className="text-gray-300 hover:text-white transition-colors">
                        {formatDate(cycle.date)}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-gray-200">{cycle.symbol}</td>
                    <td className="py-2.5 pr-4 font-mono text-gray-300">
                      {tech?.close ? formatCurrency(tech.close) : '—'}
                    </td>
                    <td className={`py-2.5 pr-4 font-mono ${
                      cycle.decision ? decisionColor(cycle.decision.decision) : 'text-gray-500'
                    }`}>
                      {cycle.decision ? formatScore(cycle.decision.weightedScore) : '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {cycle.decision ? (
                        <DecisionBadge decision={cycle.decision.decision} />
                      ) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {cycle.decision?.riskBlocked ? (
                        <span className="text-orange-400">Blocked</span>
                      ) : cycle.decision ? (
                        <span className="text-gray-500">OK</span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {cycle.trade ? (
                        <span className={cycle.trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                          {cycle.trade.side.toUpperCase()} {cycle.trade.quantity}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-400">
                      {cycle.trade?.filledPrice ? formatCurrency(cycle.trade.filledPrice) : '—'}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={cycle.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} baseHref={baseHref} />
    </div>
  );
}
