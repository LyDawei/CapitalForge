import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchSymbolCycles } from '../lib/api-client';
import { Badge } from '../components/Badges';
import { tokens, sectionStyle } from '../theme';

export function SymbolCycles() {
  const { symbol = '' } = useParams<{ symbol: string }>();
  const [page, setPage] = useState(1);

  const cycles = useQuery({
    queryKey: ['symbol-cycles', symbol, page],
    queryFn: () => fetchSymbolCycles(symbol, page, 25),
    placeholderData: (prev) => prev,
  });

  return (
    <section style={sectionStyle}>
      <div style={{ marginBottom: 12 }}>
        <Link to="/cycles" style={{ fontSize: tokens.fontSize.base }}>
          ← back to all symbols
        </Link>
      </div>
      <h2 style={{ margin: '0 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>
        {decodeURIComponent(symbol)}
      </h2>
      <p style={{ margin: '0 0 16px', color: tokens.color.textMuted, fontSize: tokens.fontSize.base }}>
        All cycles for this symbol, newest first.
      </p>

      {cycles.isLoading && <p>Loading…</p>}
      {cycles.data && cycles.data.data.length === 0 && (
        <p style={{ color: tokens.color.textMuted }}>No cycles for this symbol yet.</p>
      )}
      {cycles.data && cycles.data.data.length > 0 && (
        <>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: tokens.color.surfaceMuted }}>
                <th style={th}>Date</th>
                <th style={th}>Engine</th>
                <th style={th}>Status</th>
                <th style={th}>Action</th>
                <th style={th}>Conviction</th>
                <th style={th}>Shares</th>
                <th style={th}>Close</th>
                <th style={th}>RSI</th>
                <th style={th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {cycles.data.data.map((c) => {
                const action =
                  c.tradePlan?.action ?? c.deliberation?.finalAction ?? c.decision?.decision ?? '—';
                const outcome = renderOutcome(c);
                return (
                  <tr key={c.id}>
                    <td style={td}>
                      <Link to={`/cycles/${c.id}`} style={{ fontWeight: 500 }}>
                        {c.date}
                      </Link>
                    </td>
                    <td style={td}><Badge value={c.engineVersion} /></td>
                    <td style={td}><Badge value={c.status} /></td>
                    <td style={td}><Badge value={action} /></td>
                    <td style={td}>
                      {c.tradePlan
                        ? c.tradePlan.conviction.toFixed(2)
                        : c.deliberation
                          ? c.deliberation.conviction.toFixed(2)
                          : '—'}
                    </td>
                    <td style={td}>{c.tradePlan?.shares ?? '—'}</td>
                    <td style={td}>${c.technicalData.close.toFixed(2)}</td>
                    <td style={td}>{c.technicalData.rsi.toFixed(1)}</td>
                    <td style={td}>{outcome}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: tokens.fontSize.base }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={btn}>
              ← Prev
            </button>
            <span>
              Page {cycles.data.pagination.page} of {cycles.data.pagination.totalPages || 1} ·{' '}
              {cycles.data.pagination.total} total
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= cycles.data.pagination.totalPages}
              style={btn}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function renderOutcome(c: { tradePlan?: unknown }) {
  const tp = c.tradePlan as
    | {
        status: string;
        action: string;
        realizedPnl: number | null;
        riskDollars: number;
        closeReason: string | null;
      }
    | null
    | undefined;
  if (!tp || tp.action !== 'BUY') return '—';
  if (tp.status !== 'closed' || tp.realizedPnl === null) {
    return <span style={{ color: tokens.color.textMuted }}>{tp.status}</span>;
  }
  const r = tp.riskDollars > 0 ? tp.realizedPnl / tp.riskDollars : 0;
  const win = tp.realizedPnl > 0;
  return (
    <span style={{ color: win ? tokens.color.success : tokens.color.danger, fontFamily: tokens.font.mono }}>
      {win ? '+' : ''}
      {r.toFixed(2)}R
      <span style={{ color: tokens.color.textMuted, marginLeft: 6, fontSize: 11 }}>
        ({tp.closeReason?.replace('_', ' ')})
      </span>
    </span>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: tokens.fontSize.base,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: tokens.fontSize.xs,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: tokens.color.text,
  borderBottom: `1px solid ${tokens.color.border}`,
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: `1px solid ${tokens.color.surfaceMuted}`,
};
const btn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.color.borderStrong}`,
  background: 'white',
  cursor: 'pointer',
};
