import { useState } from 'react';
import { useFeeds, useFeedDetail, useFeedSourceSummary, type FeedFetchRow } from '../api/hooks';
import { dateTime } from '../lib/format';

export default function Feeds() {
  const [source, setSource] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [erroredOnly, setErroredOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useFeedSourceSummary();
  const list = useFeeds({
    source: source || undefined,
    symbol: symbol || undefined,
    errored: erroredOnly ? true : undefined,
    limit: 100,
  });

  return (
    <div>
      <h1 className="page-title">Feeds</h1>
      <p className="page-subtitle">
        Every external-data pull. Each row is one fetch (Alpaca news, Finnhub earnings, FRED
        series, sector ETF bars). Click any row to see the payload and the agent runs that
        consumed it — and what those agents decided.
      </p>

      <div className="card">
        <h2>Source summary</h2>
        {summary.isLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th style={{ textAlign: 'right' }}>Fetches</th>
                <th style={{ textAlign: 'right' }}>Total latency (ms)</th>
                <th style={{ textAlign: 'right' }}>Total cost ($)</th>
              </tr>
            </thead>
            <tbody>
              {(summary.data ?? []).map((s) => (
                <tr key={s.source} style={{ cursor: 'pointer' }} onClick={() => setSource(s.source)}>
                  <td>
                    <code>{s.source}</code>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{s.totalFetches}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{s.totalLatencyMs}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {s.totalCostUsd > 0 ? s.totalCostUsd.toFixed(4) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Filter</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Source">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="alpaca_news, fred_dgs10…"
              style={inputStyle}
            />
          </Field>
          <Field label="Symbol">
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="SPY"
              style={inputStyle}
            />
          </Field>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-dim)',
            }}
          >
            <input type="checkbox" checked={erroredOnly} onChange={(e) => setErroredOnly(e.target.checked)} />
            Errored only
          </label>
          <button onClick={() => { setSource(''); setSymbol(''); setErroredOnly(false); }} style={btnSmallStyle('var(--text-dim)')}>
            Clear
          </button>
        </div>
      </div>

      <div className="grid cols-2" style={{ gap: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2>Recent fetches</h2>
          {list.isLoading ? (
            <div className="empty">Loading…</div>
          ) : !list.data || list.data.fetches.length === 0 ? (
            <div className="empty">No fetches yet — run a cycle to populate.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Source</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>ms</th>
                  <th style={{ textAlign: 'right' }}>Consumers</th>
                </tr>
              </thead>
              <tbody>
                {list.data.fetches.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    style={{
                      cursor: 'pointer',
                      background: selectedId === r.id ? 'var(--panel-2)' : undefined,
                    }}
                  >
                    <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-dim)' }}>
                      {dateTime(r.fetchedAt)}
                    </td>
                    <td>
                      <code>{r.source}</code>
                    </td>
                    <td>{r.symbol ?? '—'}</td>
                    <td>
                      {r.errored ? (
                        <span className="badge" style={{ background: 'rgba(239,107,115,0.12)', color: 'var(--danger)' }}>
                          errored
                        </span>
                      ) : (
                        <span className="badge ok">ok</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {r.latencyMs}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {r._count.consumptions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          {selectedId ? (
            <FeedDetail id={selectedId} />
          ) : (
            <div className="empty">Click a fetch to see payload + consumers.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedDetail({ id }: { id: string }) {
  const { data, isLoading } = useFeedDetail(id);
  if (isLoading || !data) return <div className="empty">Loading…</div>;
  return (
    <>
      <h2 style={{ marginTop: 0 }}>
        <code>{data.source}</code> {data.symbol ? `· ${data.symbol}` : ''}
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Fetched {dateTime(data.fetchedAt)} · {data.latencyMs}ms ·{' '}
        {data.errored ? <span style={{ color: 'var(--danger)' }}>errored: {data.errorMessage}</span> : 'ok'}
      </div>
      {data.url && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
          URL: <code>{data.url}</code>
        </div>
      )}

      <h3 style={{ fontSize: 13, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16 }}>
        Consumers ({data.consumptions.length})
      </h3>
      {data.consumptions.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Nothing consumed this fetch yet.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Run</th>
              <th>Influence</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {data.consumptions.map((c) => {
              const p = c.agentRun.parsedOutput ?? {};
              const decision =
                p.action ??
                (typeof p.bullishScore === 'number'
                  ? `score=${p.bullishScore.toFixed(2)} conf=${(p.confidence ?? 0).toFixed(2)}`
                  : c.agentRun.schemaValid
                    ? 'parsed'
                    : 'schema fail');
              return (
                <tr key={c.id}>
                  <td>{c.agentRun.agent.displayName}</td>
                  <td>
                    <span className="badge" style={{ fontSize: 10 }}>{c.agentRun.runKind}</span>
                  </td>
                  <td style={{ color: 'var(--accent-2)', fontSize: 12 }}>
                    {c.influenceTag ? <code>{c.influenceTag}</code> : '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>{String(decision).slice(0, 60)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 style={{ fontSize: 13, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16 }}>
        Payload
      </h3>
      <pre
        className="prompt"
        style={{ maxHeight: 400, overflow: 'auto', fontSize: 11 }}
      >
        {JSON.stringify(data.payload, null, 2)}
      </pre>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 14,
};

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
