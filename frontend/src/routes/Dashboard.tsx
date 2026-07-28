import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAgents,
  useCycles,
  useAnomalies,
  usePredictionScores,
  useAlpacaAccountSummary,
  type AlpacaAccountSummary,
} from '../api/hooks';
import { api } from '../api/client';
import MetricCard from '../components/MetricCard';
import AgentBadge from '../components/AgentBadge';
import { PredictionBadge } from '../components/PredictionBadge';
import { pct } from '../lib/format';

export default function Dashboard() {
  const agents = useAgents();
  const cycles = useCycles(10);
  const anomalies = useAnomalies(true);
  const predictions = usePredictionScores();
  const needingReview = (predictions.data ?? []).filter((p) => p.needsReview);
  const qc = useQueryClient();

  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);

  const agentCount = agents.data?.length ?? 0;
  const activeAgents = agents.data?.filter((a) => a.isActive).length ?? 0;
  const cycleCount = cycles.data?.total ?? 0;
  const openAnomalies = anomalies.data?.length ?? 0;

  async function runOneCycle() {
    setRunning(true);
    setRunLog((prev) => [...prev, 'Running cycle for SPY...']);
    try {
      const res = await api<any>('/api/runner/run-cycle', {
        method: 'POST',
        body: JSON.stringify({ symbol: 'SPY', date: new Date().toISOString().slice(0, 10) }),
      });
      setRunLog((prev) => [...prev, `${res.symbol} ${res.date} -> ${res.action ?? 'HOLD'} (${res.totalLatencyMs}ms)`]);
      qc.invalidateQueries();
    } catch (e: any) {
      setRunLog((prev) => [...prev, `Error: ${e.message}`]);
    }
    setRunning(false);
  }

  async function runBatch() {
    setRunning(true);
    const symbols = ['SPY', 'AAPL', 'NVDA', 'TSLA'];
    const today = new Date().toISOString().slice(0, 10);
    for (const symbol of symbols) {
      setRunLog((prev) => [...prev, `Running ${symbol}...`]);
      try {
        const res = await api<any>('/api/runner/run-cycle', {
          method: 'POST',
          body: JSON.stringify({ symbol, date: today }),
        });
        setRunLog((prev) => [...prev, `  ${res.symbol} -> ${res.action ?? 'HOLD'} (${res.totalLatencyMs}ms)`]);
      } catch (e: any) {
        setRunLog((prev) => [...prev, `  ${symbol} Error: ${e.message}`]);
      }
    }
    // Settle
    setRunLog((prev) => [...prev, 'Settling proposed trades...']);
    try {
      const res = await api<any>('/api/runner/settle', { method: 'POST' });
      setRunLog((prev) => [...prev, `Settled ${res.settled} trades.`]);
    } catch (e: any) {
      setRunLog((prev) => [...prev, `Settle error: ${e.message}`]);
    }
    qc.invalidateQueries();
    setRunning(false);
  }

  return (
    <div>
      <h1 className="page-title">Audit Console</h1>
      <p className="page-subtitle">Every LLM call is recorded. Every decision is traceable.</p>

      <div className="grid cols-4">
        <MetricCard label="Agents" value={`${activeAgents} / ${agentCount}`} sub="active / total" />
        <MetricCard label="Cycles run" value={`${cycleCount}`} />
        <MetricCard label="Open anomalies" value={`${openAnomalies}`} sub={openAnomalies > 0 ? 'needs review' : 'clean'} />
        <MetricCard label="Status" value="ok" sub="api + db" />
      </div>

      <LiveAccountCard />


      <div className="card">
        <h2>Run cycles</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <button
            onClick={runOneCycle}
            disabled={running}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: running ? 'wait' : 'pointer' }}
          >
            Run 1 cycle (SPY)
          </button>
          <button
            onClick={runBatch}
            disabled={running}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent-2)', background: 'transparent', color: 'var(--accent-2)', cursor: running ? 'wait' : 'pointer' }}
          >
            Run batch (4 symbols) + settle
          </button>
        </div>
        {runLog.length > 0 && (
          <pre className="prompt" style={{ maxHeight: 200 }}>
            {runLog.join('\n')}
          </pre>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Agents</h2>
          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>Runs</th></tr></thead>
            <tbody>
              {agents.data?.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/agents/${a.name}`}>{a.displayName}</Link></td>
                  <td><AgentBadge kind={a.kind} /></td>
                  <td>{a._count?.runs ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Recent cycles</h2>
          <table>
            <thead><tr><th>Date</th><th>Symbol</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {cycles.data?.cycles.map((c) => (
                <tr key={c.id}>
                  <td>{c.date}</td>
                  <td><Link to={`/cycles/${c.id}`}>{c.symbol}</Link></td>
                  <td><span className={`badge ${c.status === 'completed' ? 'ok' : c.status === 'failed' ? 'danger' : ''}`}>{c.status}</span></td>
                  <td>{c.tradePlan?.action ?? '—'}</td>
                </tr>
              ))}
              {cycles.data?.cycles.length === 0 && <tr><td colSpan={4} className="empty">No cycles yet — click "Run batch" above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {needingReview.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2>Agents that may need prompt revision</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            These agents are predicting worse than expected. Review their prompts, recent runs,
            and consider iterating the template.
          </p>
          <table>
            <thead><tr><th>Agent</th><th>Hit rate</th><th>Samples</th><th>Reasons</th><th></th></tr></thead>
            <tbody>
              {needingReview.map((p) => (
                <tr key={p.agentId}>
                  <td><Link to={`/agents/${p.agentName}`}>{p.displayName}</Link></td>
                  <td><PredictionBadge score={p} /></td>
                  <td>{p.sampleSize}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{p.reviewReasons.join(' · ')}</td>
                  <td><Link to={`/agents/${p.agentName}`}>review →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openAnomalies > 0 && (
        <div className="card">
          <h2>Anomalies</h2>
          <table>
            <thead><tr><th>Kind</th><th>Severity</th><th>Body</th><th>When</th></tr></thead>
            <tbody>
              {anomalies.data?.map((a) => (
                <tr key={a.id}>
                  <td>{a.kind}</td>
                  <td><span className={`badge ${a.severity === 'error' ? 'danger' : a.severity === 'warn' ? 'warn' : ''}`}>{a.severity}</span></td>
                  <td>{a.body}</td>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveAccountCard — Alpaca paper-account state surfaced for read-only audit.
// Distinct from V2's internal Wallet ledger: the Alpaca account holds any
// real or V1-era positions; the V2 Wallet is a separate simulated ledger
// that tracks counterfactual P&L from settled TradePlans. Both are useful
// to see side-by-side, especially before Phase B order execution lands.
// Refreshes every 30s via TanStack Query.
// ---------------------------------------------------------------------------
function LiveAccountCard() {
  const { data, isLoading, error } = useAlpacaAccountSummary();
  if (isLoading) {
    return <div className="card empty">Loading Alpaca account…</div>;
  }
  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h2>Alpaca paper account</h2>
        <p style={{ color: 'var(--danger)', fontSize: 12 }}>
          Failed to read account: {(error as any)?.message ?? 'unknown'}
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Likely cause: <code>ALPACA_API_KEY</code> / <code>ALPACA_API_SECRET</code> missing or invalid,
          or <code>MODE</code> isn't set to <code>paper</code>. Account state goes through the
          paper trading host (<code>paper-api.alpaca.markets</code>), separate from the data API.
        </p>
      </div>
    );
  }
  if (!data?.account) {
    return (
      <div className="card">
        <h2>Alpaca paper account</h2>
        <p className="empty">No account data available (mock mode or unavailable).</p>
      </div>
    );
  }
  return <AccountCardBody summary={data} />;
}

function AccountCardBody({ summary }: { summary: AlpacaAccountSummary }) {
  const a = summary.account!;
  const positiveEquity = a.unrealizedPl >= 0;
  return (
    <div className="card">
      <h2>Alpaca paper account</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>
        Brokerage state (read-only). V2's internal Wallet is separate — that's where simulated
        P&amp;L from settled TradePlans goes. The Alpaca account holds any real/V1-era positions.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard
          label="Equity"
          value={`$${a.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          sub={`P&L: ${positiveEquity ? '+' : ''}$${a.unrealizedPl.toFixed(2)}`}
        />
        <MetricCard
          label="Cash"
          value={`$${a.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          sub={`buying power: $${a.buyingPower.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <MetricCard
          label="Positions"
          value={`${summary.positions.length}`}
          sub={`long: $${a.longMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <MetricCard
          label="Status"
          value={a.status.toLowerCase()}
          sub={a.patternDayTrader ? 'PDT flagged' : 'non-PDT'}
        />
      </div>

      <div className="grid cols-2">
        <div>
          <h3 style={cardSubHeader}>Open positions</h3>
          {summary.positions.length === 0 ? (
            <p className="empty">No open positions.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Avg</th>
                  <th style={{ textAlign: 'right' }}>Current</th>
                  <th style={{ textAlign: 'right' }}>P&L</th>
                </tr>
              </thead>
              <tbody>
                {summary.positions.map((p) => (
                  <tr key={p.symbol}>
                    <td><code>{p.symbol}</code></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.qty.toFixed(3)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${p.avgEntryPrice.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${p.currentPrice.toFixed(2)}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        color: p.unrealizedPl >= 0 ? 'var(--accent)' : 'var(--danger)',
                      }}
                    >
                      {p.unrealizedPl >= 0 ? '+' : ''}${p.unrealizedPl.toFixed(2)}
                      <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>
                        ({(p.unrealizedPlPct * 100).toFixed(2)}%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 style={cardSubHeader}>Recent orders</h3>
          {summary.orders.length === 0 ? (
            <p className="empty">No recent orders.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Fill</th>
                </tr>
              </thead>
              <tbody>
                {summary.orders.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {new Date(o.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td><code>{o.symbol}</code></td>
                    <td>
                      <span className={`badge ${o.side === 'buy' ? 'ok' : 'warn'}`}>{o.side}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {o.qty.toFixed(3)}
                    </td>
                    <td>
                      <span className={`badge ${o.status === 'filled' ? 'ok' : ''}`}>{o.status}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {o.filledAvgPrice != null ? `$${o.filledAvgPrice.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {summary.errors.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>
          Partial data: {summary.errors.map((e) => `${e.kind} (${e.message})`).join('; ')}
        </div>
      )}
    </div>
  );
}

const cardSubHeader: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
};
