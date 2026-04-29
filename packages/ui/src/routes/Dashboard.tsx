import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchPortfolioState,
  fetchCycles,
  fetchHealth,
  fetchPortfolioOutcomes,
  settlePlans,
} from '../lib/api-client';
import { Badge } from '../components/Badges';
import { WalletSection } from '../components/WalletSection';
import { RiskConfigSection } from '../components/RiskConfigSection';

export function Dashboard() {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });
  const portfolio = useQuery({ queryKey: ['portfolio-state'], queryFn: fetchPortfolioState });
  const outcomes = useQuery({
    queryKey: ['portfolio-outcomes'],
    queryFn: fetchPortfolioOutcomes,
  });
  const cycles = useQuery({
    queryKey: ['cycles', 'recent'],
    queryFn: () => fetchCycles({ pageSize: 10 }),
  });
  const settleMut = useMutation({
    mutationFn: settlePlans,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-outcomes'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['agent-performance'] });
    },
  });

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <WalletSection />

      <RiskConfigSection />

      <section>
        <h2 style={{ marginTop: 0 }}>Portfolio</h2>
        {portfolio.isLoading && <p>Loading…</p>}
        {portfolio.data === null && <p>No sandbox snapshots yet — run a cycle.</p>}
        {portfolio.data && (
          <div style={cardGrid}>
            <Stat label="Equity" value={`$${portfolio.data.currentEquity.toFixed(2)}`} />
            <Stat label="Cash" value={`$${portfolio.data.cashBalance.toFixed(2)}`} />
            <Stat
              label="Position"
              value={
                portfolio.data.positionQty > 0
                  ? `${portfolio.data.positionQty} ${portfolio.data.positionSymbol}`
                  : 'Flat'
              }
            />
            <Stat label="Peak Equity" value={`$${portfolio.data.peakEquity.toFixed(2)}`} />
            <Stat
              label="Drawdown"
              value={`${(portfolio.data.drawdownPct * 100).toFixed(1)}%`}
              tone={portfolio.data.drawdownPct >= 0.1 ? 'warn' : 'ok'}
            />
            <Stat label="Last snapshot" value={portfolio.data.date} />
          </div>
        )}
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>Trade outcomes</h2>
          <button
            onClick={() => settleMut.mutate()}
            disabled={settleMut.isPending}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: 'white',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {settleMut.isPending ? 'Settling…' : 'Settle proposed plans'}
          </button>
        </div>
        {outcomes.data && (
          <div style={{ ...cardGrid, marginTop: 12 }}>
            <Stat label="Settled" value={outcomes.data.settled.toString()} />
            <Stat
              label="Win rate"
              value={
                outcomes.data.winRate === null
                  ? 'n/a'
                  : `${(outcomes.data.winRate * 100).toFixed(1)}%`
              }
              tone={
                outcomes.data.winRate !== null && outcomes.data.winRate >= 0.5 ? 'ok' : 'warn'
              }
            />
            <Stat
              label="Wins / Losses"
              value={`${outcomes.data.wins}W · ${outcomes.data.losses}L`}
            />
            <Stat
              label="Total R"
              value={
                outcomes.data.totalR === 0
                  ? '—'
                  : `${outcomes.data.totalR >= 0 ? '+' : ''}${outcomes.data.totalR.toFixed(2)}R`
              }
              tone={outcomes.data.totalR >= 0 ? 'ok' : 'warn'}
            />
            <Stat
              label="Total P&L"
              value={`$${outcomes.data.totalPnl.toFixed(2)}`}
              tone={outcomes.data.totalPnl >= 0 ? 'ok' : 'warn'}
            />
            <Stat
              label="Avg R/trade"
              value={
                outcomes.data.avgRPerTrade === null
                  ? '—'
                  : `${outcomes.data.avgRPerTrade >= 0 ? '+' : ''}${outcomes.data.avgRPerTrade.toFixed(
                      2
                    )}R`
              }
            />
          </div>
        )}
        {outcomes.data && Object.keys(outcomes.data.closeReasons).length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#374151' }}>
            <strong>Close reasons: </strong>
            {Object.entries(outcomes.data.closeReasons).map(([k, v]) => (
              <span key={k} style={{ marginLeft: 8 }}>
                <Badge value={k.replace('_', ' ')} /> <span style={{ color: '#6b7280' }}>×{v}</span>
              </span>
            ))}
          </div>
        )}
        {settleMut.data && (
          <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            Last run: scanned {settleMut.data.scanned}, settled {settleMut.data.settled}, skipped{' '}
            {settleMut.data.skipped}.
          </p>
        )}
      </section>

      <section>
        <h2>Recent cycles</h2>
        {cycles.isLoading && <p>Loading…</p>}
        {cycles.data && cycles.data.data.length === 0 && (
          <p>No cycles yet. Run <code>npm run run-cycle -w @capitalforge/engine</code>.</p>
        )}
        {cycles.data && cycles.data.data.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Symbol</th>
                <th style={th}>Engine</th>
                <th style={th}>Status</th>
                <th style={th}>Action</th>
                <th style={th}>Conviction</th>
                <th style={th}>Close</th>
                <th style={th}>RSI</th>
              </tr>
            </thead>
            <tbody>
              {cycles.data.data.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.date}</td>
                  <td style={td}>
                    <Link to={`/cycles/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.symbol}
                    </Link>
                  </td>
                  <td style={td}><Badge value={c.engineVersion} /></td>
                  <td style={td}><Badge value={c.status} /></td>
                  <td style={td}>
                    <Badge
                      value={
                        c.tradePlan?.action ??
                        c.deliberation?.finalAction ??
                        c.decision?.decision ??
                        '—'
                      }
                    />
                  </td>
                  <td style={td}>
                    {c.tradePlan
                      ? c.tradePlan.conviction.toFixed(2)
                      : c.deliberation
                        ? c.deliberation.conviction.toFixed(2)
                        : '—'}
                  </td>
                  <td style={td}>${c.technicalData.close.toFixed(2)}</td>
                  <td style={td}>{c.technicalData.rsi.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {health.data && (
        <section style={{ fontSize: 12, color: '#6b7280' }}>
          API: {health.data.status} · DB: {health.data.dbReachable ? 'reachable' : 'down'} · uptime{' '}
          {health.data.uptimeSec}s
        </section>
      )}
    </div>
  );
}

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

function Stat({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '12px 16px',
      }}
    >
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: tone === 'warn' ? '#b91c1c' : '#111827',
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  background: '#f9fafb',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};
const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 14,
};

// Re-export inline styles for re-use
export { tableStyle as _tableStyle, th as _th, td as _td };
