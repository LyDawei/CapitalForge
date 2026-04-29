import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { fetchCycle, type CycleDetail as CycleDetailType } from '../lib/api-client';
import { Badge, ScoreBadge } from '../components/Badges';

export function CycleDetail() {
  const { id } = useParams<{ id: string }>();
  const cycle = useQuery({
    queryKey: ['cycle', id],
    queryFn: () => fetchCycle(id!),
    enabled: Boolean(id),
  });

  if (cycle.isLoading) return <p>Loading…</p>;
  if (cycle.isError) return <p style={{ color: 'crimson' }}>{(cycle.error as Error).message}</p>;
  if (!cycle.data) return <p>Not found.</p>;

  const c = cycle.data;
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <Link to="/cycles" style={{ fontSize: 13 }}>
          ← back to cycles
        </Link>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <h2 style={{ margin: '8px 0' }}>
              {c.symbol} <span style={{ color: '#6b7280', fontWeight: 400 }}>· {c.date}</span>
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge value={c.engineVersion} />
              <Badge value={c.status} />
              {c.tradePlan && <Badge value={c.tradePlan.action} />}
              {c.tradePlan && <Badge value={c.tradePlan.status} />}
            </div>
          </div>
          <Link
            to={`/cycles/${c.id}/replay`}
            style={{
              padding: '8px 14px',
              borderRadius: 4,
              background: '#1f2937',
              color: 'white',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            ▶ Replay this deliberation
          </Link>
        </div>
      </section>

      <Section title="Technical data">
        <div style={kvGrid}>
          <KV label="Close" value={`$${c.technicalData.close.toFixed(2)}`} />
          <KV label="RSI(14)" value={c.technicalData.rsi.toFixed(2)} />
          <KV label="SMA20" value={`$${c.technicalData.sma20.toFixed(2)}`} />
          <KV label="SMA50" value={`$${c.technicalData.sma50.toFixed(2)}`} />
          <KV label="MACD hist" value={c.technicalData.macdHistogram.toFixed(4)} />
          <KV label="Volume" value={c.technicalData.volume.toLocaleString()} />
          <KV label="Avg volume" value={c.technicalData.avgVolume.toLocaleString()} />
        </div>
      </Section>

      {c.tradePlan && (
        <Section title="Trade plan">
          <div style={kvGrid}>
            <KV label="Action" value={<Badge value={c.tradePlan.action} />} />
            <KV label="Conviction" value={c.tradePlan.conviction.toFixed(2)} />
            <KV label="Setup" value={c.tradePlan.setupName ?? '—'} />
            <KV label="Entry" value={`$${c.tradePlan.entry.toFixed(2)}`} />
            <KV
              label="Stop"
              value={c.tradePlan.stop ? `$${c.tradePlan.stop.toFixed(2)}` : '—'}
            />
            <KV
              label="Target 1"
              value={c.tradePlan.target1 ? `$${c.tradePlan.target1.toFixed(2)}` : '—'}
            />
            <KV
              label="Target 2"
              value={c.tradePlan.target2 ? `$${c.tradePlan.target2.toFixed(2)}` : '—'}
            />
            <KV label="Risk %" value={`${(c.tradePlan.riskPctOfEquity * 100).toFixed(2)}%`} />
            <KV label="Risk $" value={`$${c.tradePlan.riskDollars.toFixed(2)}`} />
            <KV label="Shares" value={c.tradePlan.shares.toString()} />
            <KV label="Time stop" value={c.tradePlan.timeStopBars?.toString() ?? '—'} />
            <KV label="Status" value={<Badge value={c.tradePlan.status} />} />
          </div>
          {c.tradePlan.invalidationCriteria.length > 0 && (
            <>
              <h4 style={{ margin: '12px 0 4px' }}>Invalidation criteria</h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {c.tradePlan.invalidationCriteria.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {c.specialistAnalyses.length > 0 && (
        <Section title={`Specialists (${c.specialistAnalyses.length})`}>
          <div style={{ display: 'grid', gap: 12 }}>
            {c.specialistAnalyses.map((s) => (
              <SpecialistCard key={s.id} s={s} />
            ))}
          </div>
        </Section>
      )}

      {c.deliberation && (
        <Section title="Head trader deliberation">
          <div style={kvGrid}>
            <KV label="Action" value={<Badge value={c.deliberation.finalAction} />} />
            <KV label="Conviction" value={c.deliberation.conviction.toFixed(2)} />
            <KV label="Rounds" value={c.deliberation.rounds.toString()} />
            <KV label="Latency" value={`${c.deliberation.totalLatencyMs}ms`} />
            <KV label="Model" value={c.deliberation.modelName} />
            <KV label="Prompt version" value={c.deliberation.promptVersion} />
          </div>
          <h4 style={{ margin: '16px 0 8px' }}>Reasoning trace</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {c.deliberation.reasoningTrace.map((step, i) => (
              <div
                key={i}
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                  Round {step.round}
                  {step.toolUsed ? ` · tool: ${step.toolUsed}` : ''}
                </div>
                <div>{step.thought}</div>
              </div>
            ))}
          </div>
          {c.deliberation.toolCalls.length > 0 && (
            <>
              <h4 style={{ margin: '16px 0 8px' }}>
                Tool calls ({c.deliberation.toolCalls.length})
              </h4>
              <div style={{ display: 'grid', gap: 8 }}>
                {c.deliberation.toolCalls.map((tc) => (
                  <details
                    key={tc.id}
                    style={{
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      padding: 10,
                    }}
                  >
                    <summary style={{ cursor: 'pointer' }}>
                      <strong>{tc.toolName}</strong> · round {tc.round} · {tc.latencyMs}ms{' '}
                      {tc.errored && <span style={{ color: '#b91c1c' }}>· errored</span>}
                    </summary>
                    <pre style={preStyle}>{JSON.stringify(tc.args, null, 2)}</pre>
                    <pre style={preStyle}>{JSON.stringify(tc.result, null, 2)}</pre>
                  </details>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {c.evaluations.length > 0 && (
        <Section title={`V1 Agent evaluations (${c.evaluations.length})`}>
          <div style={{ display: 'grid', gap: 12 }}>
            {c.evaluations.map((e) => (
              <div
                key={e.id}
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{e.agentName}</strong>
                  <span>
                    <ScoreBadge score={e.bullishScore} /> · conf {e.confidence.toFixed(2)}
                  </span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {e.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {c.decision && (
        <Section title="V1 Aggregated decision">
          <div style={kvGrid}>
            <KV label="Decision" value={<Badge value={c.decision.decision} />} />
            <KV label="Weighted score" value={c.decision.weightedScore.toFixed(3)} />
            <KV label="Risk blocked" value={c.decision.riskBlocked ? 'yes' : 'no'} />
            {c.decision.riskReason && <KV label="Risk reason" value={c.decision.riskReason} />}
          </div>
        </Section>
      )}

      {c.trade && (
        <Section title="Trade execution">
          <div style={kvGrid}>
            <KV label="Side" value={c.trade.side} />
            <KV label="Quantity" value={c.trade.quantity.toString()} />
            <KV label="Status" value={<Badge value={c.trade.status} />} />
            {c.trade.filledPrice && (
              <KV label="Filled price" value={`$${c.trade.filledPrice.toFixed(2)}`} />
            )}
            <KV label="Alpaca order ID" value={c.trade.alpacaOrderId} />
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {children}
    </section>
  );
}

function SpecialistCard({ s }: { s: CycleDetailType['specialistAnalyses'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{s.specialistName}</strong>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ScoreBadge score={s.bullishScore} /> conf {s.confidence.toFixed(2)}
          {s.flags.map((f) => (
            <Badge key={f} value={f} />
          ))}
        </span>
      </div>
      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        {s.rationale.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {(s.extras || s.keyLevels) && (
        <button
          onClick={() => setOpen(!open)}
          style={{ marginTop: 8, fontSize: 12, background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', padding: 0 }}
        >
          {open ? 'hide' : 'show'} extras
        </button>
      )}
      {open && (
        <pre style={preStyle}>
          {JSON.stringify({ keyLevels: s.keyLevels, extras: s.extras }, null, 2)}
        </pre>
      )}
    </div>
  );
}

const kvGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  background: '#f3f4f6',
  padding: 8,
  borderRadius: 4,
  overflowX: 'auto',
};
