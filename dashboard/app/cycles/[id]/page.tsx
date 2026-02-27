import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCycleDetail } from '@/lib/queries';
import { TechnicalData } from '@/lib/types';
import { formatCurrency, formatDate, formatScore, formatVolume, agentDisplayName } from '@/lib/utils';
import { DecisionBadge, StatusBadge } from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import AgentCard from '@/components/cycles/AgentCard';

export default async function CycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycle = await getCycleDetail(id);

  if (!cycle) notFound();

  const tech = cycle.technicalData as unknown as TechnicalData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/cycles" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            &larr; Back to Cycles
          </Link>
          <h1 className="text-xl font-bold text-white mt-1">
            {cycle.symbol} &mdash; {formatDate(cycle.date)}
          </h1>
        </div>
        <StatusBadge status={cycle.status} />
      </div>

      {/* Technical Data */}
      <Card title="Technical Indicators">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Close" value={formatCurrency(tech.close)} />
          <Stat
            label="RSI(14)"
            value={tech.rsi.toFixed(2)}
            color={tech.rsi >= 70 ? 'text-red-400' : tech.rsi <= 30 ? 'text-emerald-400' : 'text-gray-200'}
          />
          <Stat label="SMA(20)" value={formatCurrency(tech.sma20)} />
          <Stat label="SMA(50)" value={formatCurrency(tech.sma50)} />
          <Stat
            label="MACD Histogram"
            value={tech.macdHistogram.toFixed(4)}
            color={tech.macdHistogram > 0 ? 'text-emerald-400' : tech.macdHistogram < 0 ? 'text-red-400' : 'text-gray-200'}
          />
          <Stat label="Volume" value={formatVolume(tech.volume)} />
          <Stat label="Avg Volume" value={formatVolume(tech.avgVolume)} />
          <Stat
            label="SMA Cross"
            value={tech.sma20 > tech.sma50 ? 'Golden' : 'Death'}
            color={tech.sma20 > tech.sma50 ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>
      </Card>

      {/* Agent Evaluations */}
      <div>
        <h2 className="text-sm font-medium text-gray-400 mb-3">Agent Evaluations</h2>
        {cycle.evaluations.length === 0 ? (
          <p className="text-gray-500 text-sm">No evaluations recorded.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cycle.evaluations.map((evaluation) => (
              <AgentCard
                key={evaluation.id}
                evaluation={{
                  agentName: evaluation.agentName,
                  bullishScore: evaluation.bullishScore,
                  confidence: evaluation.confidence,
                  rationale: evaluation.rationale,
                  rawResponse: evaluation.rawResponse,
                  promptVersion: evaluation.promptVersion,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Aggregated Decision + Trade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Decision */}
        <Card title="Aggregated Decision">
          {cycle.decision ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Decision</span>
                <DecisionBadge decision={cycle.decision.decision} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Weighted Score</span>
                <span className={`text-sm font-mono ${
                  cycle.decision.weightedScore > 0.4
                    ? 'text-emerald-400'
                    : cycle.decision.weightedScore < -0.4
                      ? 'text-red-400'
                      : 'text-gray-300'
                }`}>
                  {formatScore(cycle.decision.weightedScore)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Risk Blocked</span>
                <span className={`text-sm ${cycle.decision.riskBlocked ? 'text-orange-400' : 'text-gray-400'}`}>
                  {cycle.decision.riskBlocked ? 'Yes' : 'No'}
                </span>
              </div>
              {cycle.decision.riskReason && (
                <div className="text-xs text-orange-400/80 bg-orange-500/10 rounded p-2 border border-orange-500/20">
                  {cycle.decision.riskReason}
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No decision recorded.</p>
          )}
        </Card>

        {/* Trade */}
        <Card title="Trade Execution">
          {cycle.trade ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Side</span>
                <span className={`text-sm font-semibold ${
                  cycle.trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {cycle.trade.side.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Symbol</span>
                <span className="text-sm text-gray-200">{cycle.trade.symbol}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Quantity</span>
                <span className="text-sm font-mono text-gray-200">{cycle.trade.quantity}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Filled Price</span>
                <span className="text-sm font-mono text-gray-200">
                  {cycle.trade.filledPrice ? formatCurrency(cycle.trade.filledPrice) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Status</span>
                <StatusBadge status={cycle.trade.status} />
              </div>
              <div className="text-xs text-gray-600 font-mono mt-2">
                Order: {cycle.trade.alpacaOrderId}
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No trade executed.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = 'text-gray-200',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-mono ${color}`}>{value}</div>
    </div>
  );
}
