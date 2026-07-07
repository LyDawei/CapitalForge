import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useWatchlistProposals,
  type WatchlistProposal,
  type WatchlistProposalStatus,
} from '../api/hooks';
import { api } from '../api/client';
import { dateTime } from '../lib/format';

export default function Watchlist() {
  const [statusFilter, setStatusFilter] = useState<WatchlistProposalStatus | 'all'>('proposed');
  const list = useWatchlistProposals(
    statusFilter === 'all' ? undefined : statusFilter,
    200,
  );
  const qc = useQueryClient();
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<string | null>(null);

  async function runDiscovery() {
    if (!confirm('Run growthScout discovery now? Real LLM calls happen if OPENAI_API_KEY is set.')) return;
    setDiscovering(true);
    setDiscoverResult(null);
    try {
      const result = await api<{
        candidatesScreened: number;
        candidatesEvaluated: number;
        proposalsCreated: number;
        totalCostUsd: number;
        totalLatencyMs: number;
      }>(`/api/watchlist/discover`, { method: 'POST' });
      setDiscoverResult(
        `Scout ran: ${result.candidatesEvaluated} candidates evaluated, ${result.proposalsCreated} new proposals. Cost: $${result.totalCostUsd.toFixed(4)}. Elapsed: ${(result.totalLatencyMs / 1000).toFixed(1)}s.`,
      );
      await qc.invalidateQueries({ queryKey: ['watchlist-proposals'] });
    } catch (e: any) {
      setDiscoverResult(`Failed: ${e.message}`);
    }
    setDiscovering(false);
  }

  return (
    <div>
      <h1 className="page-title">Watchlist</h1>
      <p className="page-subtitle">
        Stock discovery agent proposes additions to the trading watchlist. Every proposal goes
        through manual approval — the agent never modifies the live watchlist directly.
        Rejected names stay in history so the scout's calls can be audited over time.
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={runDiscovery}
            disabled={discovering}
            style={btnStyle('var(--accent)')}
          >
            {discovering ? 'Running discovery…' : 'Run discovery now'}
          </button>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Pre-screens to ~50 candidates by ADV &gt; $50M, then LLM-evaluates each.
          </span>
        </div>
        {discoverResult && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: 'var(--panel-2)',
              borderLeft: '3px solid var(--accent-2)',
              fontSize: 13,
            }}
          >
            {discoverResult}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          {(['proposed', 'approved', 'rejected', 'superseded', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                ...btnSmallStyle(statusFilter === s ? 'var(--accent)' : 'var(--text-dim)'),
                background: statusFilter === s ? 'rgba(127,200,169,0.12)' : 'transparent',
              }}
            >
              {s}
            </button>
          ))}
          <span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 'auto' }}>
            {list.data ? `${list.data.total} total` : ''}
          </span>
        </div>

        {list.isLoading ? (
          <div className="empty">Loading…</div>
        ) : !list.data || list.data.proposals.length === 0 ? (
          <div className="empty">
            No proposals {statusFilter !== 'all' ? `with status='${statusFilter}'` : 'yet'}. Click "Run
            discovery now" to fire the scout.
          </div>
        ) : (
          list.data.proposals.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              onMutate={() => qc.invalidateQueries({ queryKey: ['watchlist-proposals'] })}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ProposalCard({ p, onMutate }: { p: WatchlistProposal; onMutate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    const approvedBy = prompt('Your name / handle for the audit log:', 'david');
    if (!approvedBy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/watchlist/proposals/${p.id}/approve`, {
        method: 'POST',
        body: { approvedBy },
      });
      onMutate();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function reject() {
    const rejectedBy = prompt('Your name / handle for the audit log:', 'david');
    if (!rejectedBy) return;
    const reason = prompt(`Why reject ${p.symbol}? (one-line reason)`);
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/watchlist/proposals/${p.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejectedBy, reason }),
      });
      onMutate();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  }

  const score = p.viabilityScore;
  const scoreColor =
    score == null ? 'var(--text-dim)' : score >= 0.8 ? 'var(--accent)' : score >= 0.65 ? 'var(--accent-2)' : 'var(--danger)';
  const statusBadge = {
    proposed: { bg: 'rgba(127,200,169,0.10)', color: 'var(--accent-2)' },
    approved: { bg: 'rgba(127,200,169,0.15)', color: 'var(--accent)' },
    rejected: { bg: 'rgba(239,107,115,0.12)', color: 'var(--danger)' },
    superseded: { bg: 'rgba(180,180,180,0.10)', color: 'var(--text-dim)' },
  }[p.status];

  return (
    <div
      style={{
        padding: 12,
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <code style={{ fontSize: 16, fontWeight: 600 }}>{p.symbol}</code>
        <span className="badge" style={{ background: statusBadge.bg, color: statusBadge.color }}>
          {p.status}
        </span>
        {score != null && (
          <span style={{ fontFamily: 'monospace', color: scoreColor, fontWeight: 600 }}>
            score: {score.toFixed(2)}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
          {dateTime(p.proposedAt)} · by {p.proposedBy}
        </span>
      </div>
      {p.thesis && (
        <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--text)' }}>
          {p.thesis}
        </p>
      )}

      {expanded && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--panel-2)', borderRadius: 4 }} onClick={(e) => e.stopPropagation()}>
          {p.rationale.length > 0 && (
            <>
              <h4 style={miniHeading}>Rationale</h4>
              <ul style={{ marginTop: 4, paddingLeft: 18, fontSize: 13 }}>
                {p.rationale.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {p.concerns.length > 0 && (
            <>
              <h4 style={miniHeading}>Concerns</h4>
              <ul style={{ marginTop: 4, paddingLeft: 18, fontSize: 13, color: 'var(--danger)' }}>
                {p.concerns.map((c, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {p.quantSnapshot && (
            <>
              <h4 style={miniHeading}>Quant snapshot</h4>
              <pre style={{ fontSize: 11, marginTop: 4, color: 'var(--text-dim)' }}>
                {JSON.stringify(p.quantSnapshot, null, 2)}
              </pre>
            </>
          )}
          {p.rejectedReason && (
            <>
              <h4 style={miniHeading}>Rejected reason</h4>
              <p style={{ fontSize: 13, color: 'var(--danger)' }}>{p.rejectedReason}</p>
            </>
          )}
          {p.decidedBy && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
              Decided {dateTime(p.decidedAt!)} by {p.decidedBy}
            </p>
          )}

          {p.status === 'proposed' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={approve} disabled={busy} style={btnSmallStyle('var(--accent)')}>
                Approve
              </button>
              <button onClick={reject} disabled={busy} style={btnSmallStyle('var(--danger)')}>
                Reject
              </button>
              {error && <span style={{ color: 'var(--danger)', fontSize: 12, alignSelf: 'center' }}>{error}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const miniHeading: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginTop: 12,
  marginBottom: 0,
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
  };
}

function btnSmallStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 12,
  };
}
