import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  fetchAgent,
  fetchAgentPerformance,
  fetchNotes,
  createNote,
  deleteNote,
  settlePlans,
  type PromptVersion,
  type AgentPerformance,
  type ScoreBucket,
  type AgentNote,
} from '../lib/api-client';
import { Badge } from '../components/Badges';

export function AgentDetail() {
  const { name } = useParams<{ name: string }>();
  const detail = useQuery({
    queryKey: ['agent', name],
    queryFn: () => fetchAgent(name!),
    enabled: Boolean(name),
  });
  const perf = useQuery({
    queryKey: ['agent-performance', name],
    queryFn: () => fetchAgentPerformance(name!),
    enabled: Boolean(name),
  });

  if (detail.isLoading) return <p>Loading…</p>;
  if (detail.isError) return <p style={{ color: 'crimson' }}>{(detail.error as Error).message}</p>;
  if (!detail.data) return null;

  const { agent, promptVersions } = detail.data;
  const fullAgentKey = `${agent.name}-${agent.engineVersion}`;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <Link to="/agents" style={{ fontSize: 13 }}>← back to agents</Link>
        <h2 style={{ margin: '8px 0' }}>{agent.displayName}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge value={agent.engineVersion} />
          <Badge value={agent.kind.replace('_', ' ')} />
          {agent.toolUsing && <Badge value="tool-using" />}
        </div>
      </section>

      <Section title="Performance">
        {perf.isLoading && <p>Loading…</p>}
        {perf.data && <PerformancePanel perf={perf.data} />}
      </Section>

      <NotesSection
        agentName={agent.name}
        engineVersion={agent.engineVersion}
        agentKey={fullAgentKey}
      />

      <Section title="Configuration">
        <p style={{ marginTop: 0 }}><strong>Role:</strong> {agent.role}</p>
        <p>{agent.description}</p>

        <div style={kvGrid}>
          <KV label="Engine version" value={agent.engineVersion} />
          <KV label="Kind" value={agent.kind.replace('_', ' ')} />
          <KV label="Current prompt version" value={<code>{agent.promptVersion}</code>} />
          <KV label="Tool-using" value={agent.toolUsing ? 'yes' : 'no'} />
        </div>

        <h4 style={{ margin: '16px 0 6px' }}>Inputs</h4>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {agent.inputs.map((i, idx) => (<li key={idx}>{i}</li>))}
        </ul>

        {agent.extras.length > 0 && (
          <>
            <h4 style={{ margin: '16px 0 6px' }}>Extras (structured output fields)</h4>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {agent.extras.map((e, idx) => (
                <li key={idx}><code>{e.key}</code> — {e.description}</li>
              ))}
            </ul>
          </>
        )}

        {agent.flags && agent.flags.length > 0 && (
          <>
            <h4 style={{ margin: '16px 0 6px' }}>Flags emitted</h4>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {agent.flags.map((f) => <Badge key={f} value={f} />)}
            </div>
          </>
        )}
      </Section>

      <Section title={`Persisted prompt versions (${promptVersions.length})`}>
        {promptVersions.length === 0 && (
          <p style={{ color: '#6b7280', margin: 0 }}>
            No prompt versions persisted yet — they get written the first time this agent runs.
          </p>
        )}
        {promptVersions.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {promptVersions.map((p) => <PromptVersionItem key={p.id} prompt={p} />)}
          </div>
        )}
      </Section>
    </div>
  );
}

function PerformancePanel({ perf }: { perf: AgentPerformance }) {
  const queryClient = useQueryClient();
  const settleMutation = useMutation({
    mutationFn: settlePlans,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-performance'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-outcomes'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });

  const winRate =
    perf.outcomes.settledTradePlans > 0
      ? perf.outcomes.winningTradePlans / perf.outcomes.settledTradePlans
      : null;

  return (
    <>
      <div style={kvGrid}>
        <KV label="Total runs" value={perf.totalRuns.toString()} />
        <KV
          label="Settled trade plans"
          value={`${perf.outcomes.settledTradePlans} of ${perf.totalRuns}`}
        />
        <KV
          label="Win rate (BUY plans)"
          value={
            winRate === null ? (
              <span style={{ color: '#6b7280' }}>n/a (no outcomes yet)</span>
            ) : (
              <strong style={{ color: winRate >= 0.5 ? '#065f46' : '#991b1b' }}>
                {(winRate * 100).toFixed(1)}% ({perf.outcomes.winningTradePlans}W /
                {perf.outcomes.losingTradePlans}L)
              </strong>
            )
          }
        />
        <KV
          label="Avg score in winners"
          value={
            perf.outcomes.avgScoreInWinners === null
              ? '—'
              : perf.outcomes.avgScoreInWinners.toFixed(3)
          }
        />
        <KV
          label="Avg score in losers"
          value={
            perf.outcomes.avgScoreInLosers === null ? '—' : perf.outcomes.avgScoreInLosers.toFixed(3)
          }
        />
        <KV
          label="Avg confidence in winners"
          value={
            perf.outcomes.avgConfidenceInWinners === null
              ? '—'
              : perf.outcomes.avgConfidenceInWinners.toFixed(3)
          }
        />
      </div>

      {!perf.hasOutcomes && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <strong>No settled outcomes yet.</strong> Outcomes appear once a BUY plan has been walked
          forward to a stop / target / time-stop result. Click below to run the counterfactual
          settler over current proposed plans.
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending}
              style={btn}
            >
              {settleMutation.isPending ? 'Settling…' : 'Settle proposed plans now'}
            </button>
            {settleMutation.data && (
              <span style={{ marginLeft: 10, fontSize: 12 }}>
                Scanned {settleMutation.data.scanned}, settled {settleMutation.data.settled},
                skipped {settleMutation.data.skipped}.
              </span>
            )}
          </div>
        </div>
      )}

      <h4 style={{ margin: '20px 0 8px' }}>Score → action distribution</h4>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>
        How does the head trader's action change when this agent's bullishScore is bullish (≥+0.4),
        bearish (≤−0.4), or neutral?
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {perf.scoreBuckets.map((b) => (
          <ScoreBucketRow key={b.bucket} bucket={b} />
        ))}
      </div>

      {perf.rMultipleByBucket.some((b) => b.sample > 0) && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>R-multiple by score bucket</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {perf.rMultipleByBucket.map((row) => (
              <div
                key={row.bucket}
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 14,
                }}
              >
                <span style={{ textTransform: 'capitalize' }}>{row.bucket}</span>
                <span>
                  avg R:{' '}
                  <strong style={{ color: row.avgR > 0 ? '#065f46' : row.avgR < 0 ? '#991b1b' : '#374151' }}>
                    {row.sample === 0 ? '—' : `${row.avgR >= 0 ? '+' : ''}${row.avgR.toFixed(2)}R`}
                  </strong>
                  <span style={{ color: '#6b7280', marginLeft: 8 }}>(n={row.sample})</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ScoreBucketRow({ bucket }: { bucket: ScoreBucket }) {
  const total = Object.values(bucket.actions).reduce((a, b) => a + b, 0);
  const colorByBucket: Record<string, string> = {
    bullish: '#065f46',
    bearish: '#991b1b',
    neutral: '#374151',
  };
  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '8px 12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ textTransform: 'capitalize', color: colorByBucket[bucket.bucket] }}>
          {bucket.bucket}
        </strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{bucket.count} cycles</span>
      </div>
      {total === 0 ? (
        <div style={{ color: '#9ca3af', fontSize: 13 }}>—</div>
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(bucket.actions).map(([action, count]) => (
            <span
              key={action}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Badge value={action} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {count} ({Math.round((count / total) * 100)}%)
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesSection({
  agentName,
  engineVersion,
  agentKey,
}: {
  agentName: string;
  engineVersion: 'v1' | 'v2';
  agentKey: string;
}) {
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: ['notes', agentName, engineVersion],
    queryFn: () => fetchNotes({ agent: agentName, engineVersion }),
  });

  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('');

  const createMut = useMutation({
    mutationFn: () =>
      createNote({
        agentName,
        engineVersion,
        body: body.trim(),
        author: author.trim() || undefined,
      }),
    onSuccess: () => {
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['notes', agentName, engineVersion] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', agentName, engineVersion] });
    },
  });

  return (
    <Section title={`Improvement notes (${notes.data?.length ?? 0})`}>
      <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13 }}>
        Capture observations about how this agent should be improved — failure modes, prompt edits to
        try, dataset gaps, edge cases.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim().length === 0) return;
          createMut.mutate();
        }}
        style={{
          display: 'grid',
          gap: 8,
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 12,
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's the issue? What should change?"
          rows={3}
          style={{
            width: '100%',
            padding: 8,
            borderRadius: 4,
            border: '1px solid #d1d5db',
            fontFamily: 'inherit',
            fontSize: 14,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author (optional)"
            style={{
              flex: '0 0 200px',
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            disabled={body.trim().length === 0 || createMut.isPending}
            style={btn}
          >
            {createMut.isPending ? 'Saving…' : `Add note for ${agentKey}`}
          </button>
        </div>
      </form>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {(notes.data ?? []).map((n) => (
          <NoteCard key={n.id} note={n} onDelete={() => deleteMut.mutate(n.id)} />
        ))}
        {notes.data && notes.data.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No notes yet.</p>
        )}
      </div>
    </Section>
  );
}

function NoteCard({ note, onDelete }: { note: AgentNote; onDelete: () => void }) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {note.author ?? 'anonymous'} · {new Date(note.createdAt).toLocaleString()}
        </span>
        <button
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            color: '#991b1b',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          delete
        </button>
      </div>
      <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 14 }}>{note.body}</div>
    </div>
  );
}

function PromptVersionItem({ prompt }: { prompt: PromptVersion }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
        <span><code>{prompt.version}</code></span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {new Date(prompt.createdAt).toLocaleString()}
        </span>
      </summary>
      {open && (
        <pre
          style={{
            marginTop: 12,
            background: '#1f2937',
            color: '#f9fafb',
            padding: 12,
            borderRadius: 4,
            overflowX: 'auto',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {prompt.template}
        </pre>
      )}
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}
    >
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {children}
    </section>
  );
}

const kvGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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

const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  background: 'white',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
