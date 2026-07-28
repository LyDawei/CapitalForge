import { useParams, Link } from 'react-router-dom';
import { useCycle } from '../api/hooks';
import { dateTime, ms, usd, num } from '../lib/format';
import AgentBadge from '../components/AgentBadge';
import InfoTooltip from '../components/InfoTooltip';

export default function CycleDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useCycle(id);
  if (isLoading) return <div className="empty">Loading…</div>;
  if (!data) return <div className="empty">Cycle not found.</div>;
  const c = data;

  return (
    <div>
      <h1 className="page-title">{c.symbol} — {c.date}</h1>
      <p className="page-subtitle">
        <span className={`badge ${c.status === 'completed' ? 'ok' : c.status === 'failed' ? 'danger' : ''}`}>{c.status}</span>
        {' · '}cycle id <code>{c.id.slice(0, 8)}</code>
      </p>

      <div className="card">
        <h2>Technicals</h2>
        <pre className="prompt">{JSON.stringify(c.technicals, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>Specialist analyses ({c.specialistAnalyses?.length ?? 0})</h2>
        <table>
          <thead>
            <tr>
              <th>Specialist</th>
              <th>Score <InfoTooltip text="-1 (bearish) to +1 (bullish) — this specialist's directional lean on the symbol. 0 means neutral/no opinion." /></th>
              <th>Confidence <InfoTooltip text="0-1, how sure the specialist is in its own score above — not the same as the score's direction or magnitude." /></th>
              <th>Flags</th><th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            {c.specialistAnalyses?.map((s: any) => (
              <tr key={s.id}>
                <td>{s.agentName}</td>
                <td>{num(s.bullishScore)}</td>
                <td>{num(s.confidence)}</td>
                <td>{(s.flags ?? []).map((f: string) => <span key={f} className="badge" style={{ marginRight: 4 }}>{f}</span>)}</td>
                <td style={{ color: 'var(--text-dim)' }}>{(s.rationale ?? []).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.tradePlan && (
        <div className="card">
          <h2>Trade plan</h2>
          <div className="grid cols-4">
            <div><div className="label">Action</div><div className="value">{c.tradePlan.action}</div></div>
            <div><div className="label">Conviction <InfoTooltip text="0-1 confidence in this decision; drives position size." /></div><div className="value">{num(c.tradePlan.conviction)}</div></div>
            <div><div className="label">Entry</div><div className="value">{num(c.tradePlan.entry)}</div></div>
            <div><div className="label">Stop <InfoTooltip text="Price at which the position is closed for a loss to cap downside." /></div><div className="value">{num(c.tradePlan.stop)}</div></div>
            <div><div className="label">Target 1 <InfoTooltip text="First profit-taking price level." /></div><div className="value">{num(c.tradePlan.target1)}</div></div>
            <div><div className="label">Target 2</div><div className="value">{num(c.tradePlan.target2)}</div></div>
            <div><div className="label">Risk % <InfoTooltip text="% of total account equity that would be lost if the stop is hit — i.e. the position is sized so a stop-out costs this much, no more." /></div><div className="value">{num((c.tradePlan.riskPctOfEquity ?? 0) * 100)}%</div></div>
            <div><div className="label">Status</div><div className="value">{c.tradePlan.status}</div></div>
          </div>
          {c.tradePlan.outcome && (
            <>
              <h2 style={{ marginTop: 16 }}>Outcome</h2>
              <div className="grid cols-3">
                <div><div className="label">Reason</div><div className="value">{c.tradePlan.outcome.closeReason}</div></div>
                <div><div className="label">P&amp;L</div><div className="value">{num(c.tradePlan.outcome.realizedPnl)}</div></div>
                <div>
                  <div className="label">
                    R-multiple <InfoTooltip text="P&L expressed as a multiple of the risk taken. R=1 means it made exactly what was risked; R=2 means twice that; R=-1 means the full risked amount was lost (a stop-out)." />
                  </div>
                  <div className="value">{num(c.tradePlan.outcome.rMultiple)}</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {c.deliberation && (
        <div className="card">
          <h2>Head trader deliberation</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            {c.deliberation.rounds} rounds · {ms(c.deliberation.totalLatencyMs)} · {usd(c.deliberation.totalCostUsd, 4)} · {c.deliberation.modelName}
          </p>
          <pre className="prompt">{JSON.stringify(c.deliberation.reasoningTrace, null, 2)}</pre>
        </div>
      )}

      <div className="card">
        <h2>Agent runs in this cycle</h2>
        <table>
          <thead><tr><th>Agent</th><th>Kind</th><th>Latency</th><th>Tokens</th><th>Valid</th></tr></thead>
          <tbody>
            {c.runs?.map((r: any) => (
              <tr key={r.id}>
                <td>{r.agent.displayName}</td>
                <td><AgentBadge kind={r.agent.kind} /></td>
                <td>{ms(r.latencyMs)}</td>
                <td>{(r.tokensIn ?? 0) + (r.tokensOut ?? 0)}</td>
                <td>{r.schemaValid ? <span className="badge ok">ok</span> : <span className="badge danger">fail</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.critiques?.length > 0 && (
        <div className="card">
          <h2>Critiques ({c.critiques.length})</h2>
          <ul>
            {c.critiques.map((q: any) => (
              <li key={q.id}>
                <span className={`badge ${q.severity === 'error' ? 'danger' : q.severity === 'warn' ? 'warn' : ''}`}>{q.severity}</span>
                {' '}<strong>{q.author}</strong> · {q.body}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
