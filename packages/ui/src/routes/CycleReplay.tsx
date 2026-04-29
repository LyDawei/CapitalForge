import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCycle, type CycleDetail } from '../lib/api-client';
import { Badge, ScoreBadge } from '../components/Badges';
import { tokens, sectionStyle } from '../theme';

type Frame =
  | { kind: 'context'; title: string }
  | { kind: 'specialist'; data: CycleDetail['specialistAnalyses'][number] }
  | { kind: 'evaluation'; data: CycleDetail['evaluations'][number] }
  | { kind: 'reasoning'; round: number; thought: string; toolUsed: string | null }
  | { kind: 'tool'; data: NonNullable<CycleDetail['deliberation']>['toolCalls'][number] }
  | { kind: 'tradePlan'; data: NonNullable<CycleDetail['tradePlan']> }
  | { kind: 'decision'; data: NonNullable<CycleDetail['decision']> };

const FRAME_TITLES: Record<Frame['kind'], string> = {
  context: 'Setup',
  specialist: 'Specialist analysis',
  evaluation: 'V1 agent evaluation',
  reasoning: 'Head trader reasoning',
  tool: 'Tool call',
  tradePlan: 'Final trade plan',
  decision: 'Aggregated decision',
};

export function CycleReplay() {
  const { id = '' } = useParams<{ id: string }>();
  const cycle = useQuery({ queryKey: ['cycle', id], queryFn: () => fetchCycle(id), enabled: !!id });

  const frames = useMemo(() => buildFrames(cycle.data), [cycle.data]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);

  // Reset idx if frames change
  useEffect(() => setIdx(0), [cycle.data?.id]);

  // Auto-advance
  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, frames.length - 1)), speed);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length, speed]);

  if (cycle.isLoading) return <p>Loading…</p>;
  if (!cycle.data) return <p>Not found.</p>;
  if (frames.length === 0) {
    return (
      <section style={sectionStyle}>
        <p>Nothing to replay — this cycle has no specialists, evaluations, or deliberation yet.</p>
        <Link to={`/cycles/${id}`}>Back to cycle</Link>
      </section>
    );
  }

  const frame = frames[idx];
  const c = cycle.data;
  const progress = (idx + 1) / frames.length;

  return (
    <section style={sectionStyle}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <Link to={`/cycles/${id}`} style={{ fontSize: tokens.fontSize.base }}>
              ← back to cycle
            </Link>
            <h2 style={{ margin: '8px 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>
              {c.symbol} <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}>· {c.date}</span>
            </h2>
            <p style={{ margin: 0, color: tokens.color.textMuted, fontSize: tokens.fontSize.base }}>
              Step through the deliberation as it unfolded — specialists, head trader reasoning, and final plan.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge value={c.engineVersion} />
            <Badge value={c.status} />
            {c.tradePlan && <Badge value={c.tradePlan.action} />}
          </div>
        </div>
      </header>

      {/* Progress bar with frame markers */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            position: 'relative',
            height: 6,
            background: tokens.color.surfaceMuted,
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: `${progress * 100}%`,
              background: tokens.color.accent,
              transition: 'width 200ms',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: tokens.fontSize.xs,
            color: tokens.color.textMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>
            {idx + 1} / {frames.length} · {FRAME_TITLES[frame.kind]}
          </span>
          <FrameDots frames={frames} idx={idx} onSelect={setIdx} />
        </div>
      </div>

      {/* Current frame */}
      <div
        key={idx}
        style={{
          minHeight: 280,
          background: 'white',
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: 18,
          animation: 'fadein 220ms ease-out',
        }}
      >
        <FrameView frame={frame} cycle={c} />
      </div>

      {/* Controls */}
      <div
        style={{
          marginTop: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => setIdx(0)}
          disabled={idx === 0}
          style={btnStyle}
          aria-label="Restart"
        >
          ⏮
        </button>
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          style={btnStyle}
          aria-label="Previous frame"
        >
          ◀
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={idx >= frames.length - 1 && !playing}
          style={{ ...btnStyle, background: playing ? tokens.color.accent : 'white', color: playing ? 'white' : tokens.color.text }}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))}
          disabled={idx >= frames.length - 1}
          style={btnStyle}
          aria-label="Next frame"
        >
          ▶
        </button>
        <button
          onClick={() => setIdx(frames.length - 1)}
          disabled={idx >= frames.length - 1}
          style={btnStyle}
          aria-label="Skip to end"
        >
          ⏭
        </button>
        <span style={{ marginLeft: 16, fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
          Speed:
        </span>
        {[2500, 1500, 800].map((ms, i) => {
          const labels = ['0.5×', '1×', '2×'];
          return (
            <button
              key={ms}
              onClick={() => setSpeed(ms)}
              style={{
                ...btnStyle,
                padding: '4px 8px',
                fontSize: tokens.fontSize.xs,
                background: speed === ms ? tokens.color.accent : 'white',
                color: speed === ms ? 'white' : tokens.color.text,
              }}
            >
              {labels[i]}
            </button>
          );
        })}
      </div>

      <style>{`@keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
    </section>
  );
}

function buildFrames(c: CycleDetail | undefined): Frame[] {
  if (!c) return [];
  const frames: Frame[] = [
    { kind: 'context', title: `${c.symbol} on ${c.date}` },
  ];
  for (const s of c.specialistAnalyses) frames.push({ kind: 'specialist', data: s });
  for (const e of c.evaluations) frames.push({ kind: 'evaluation', data: e });
  if (c.deliberation) {
    for (const r of c.deliberation.reasoningTrace) {
      frames.push({ kind: 'reasoning', round: r.round, thought: r.thought, toolUsed: r.toolUsed });
    }
    for (const tc of c.deliberation.toolCalls) frames.push({ kind: 'tool', data: tc });
  }
  if (c.tradePlan) frames.push({ kind: 'tradePlan', data: c.tradePlan });
  if (c.decision) frames.push({ kind: 'decision', data: c.decision });
  return frames;
}

function FrameView({ frame, cycle: c }: { frame: Frame; cycle: CycleDetail }) {
  if (frame.kind === 'context') {
    return (
      <>
        <FrameHeader title="Setup" subtitle="Market context the agents will deliberate on." />
        <div style={kvGrid}>
          <KV label="Symbol" value={<strong>{c.symbol}</strong>} />
          <KV label="Date" value={c.date} />
          <KV label="Close" value={`$${c.technicalData.close.toFixed(2)}`} />
          <KV label="RSI(14)" value={c.technicalData.rsi.toFixed(2)} />
          <KV label="SMA20" value={`$${c.technicalData.sma20.toFixed(2)}`} />
          <KV label="SMA50" value={`$${c.technicalData.sma50.toFixed(2)}`} />
          <KV label="MACD hist" value={c.technicalData.macdHistogram.toFixed(4)} />
          <KV label="Volume" value={c.technicalData.volume.toLocaleString()} />
        </div>
      </>
    );
  }
  if (frame.kind === 'specialist') {
    const s = frame.data;
    return (
      <>
        <FrameHeader
          title={s.specialistName}
          subtitle="A specialist weighs in on its slice of the setup."
          right={
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ScoreBadge score={s.bullishScore} />
              <span style={{ fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
                conf {s.confidence.toFixed(2)}
              </span>
            </span>
          }
        />
        {s.flags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {s.flags.map((f) => <Badge key={f} value={f} />)}
          </div>
        )}
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
          {s.rationale.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {s.extras && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
              extras
            </summary>
            <pre style={preStyle}>{JSON.stringify(s.extras, null, 2)}</pre>
          </details>
        )}
      </>
    );
  }
  if (frame.kind === 'evaluation') {
    const e = frame.data;
    return (
      <>
        <FrameHeader
          title={`${e.agentName} (V1)`}
          subtitle="Legacy V1 agent evaluation."
          right={
            <span>
              <ScoreBadge score={e.bullishScore} />{' '}
              <span style={{ fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
                conf {e.confidence.toFixed(2)}
              </span>
            </span>
          }
        />
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
          {e.rationale.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </>
    );
  }
  if (frame.kind === 'reasoning') {
    return (
      <>
        <FrameHeader
          title={`Head trader · round ${frame.round}`}
          subtitle="The head trader reasons through specialists' input."
          right={frame.toolUsed ? <Badge value={`tool: ${frame.toolUsed}`} /> : undefined}
        />
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>{frame.thought}</p>
      </>
    );
  }
  if (frame.kind === 'tool') {
    const tc = frame.data;
    return (
      <>
        <FrameHeader
          title={`Tool: ${tc.toolName}`}
          subtitle={`Round ${tc.round} · ${tc.latencyMs}ms`}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={miniLabel}>Args</div>
            <pre style={preStyle}>{JSON.stringify(tc.args, null, 2)}</pre>
          </div>
          <div>
            <div style={miniLabel}>Result</div>
            <pre style={preStyle}>{JSON.stringify(tc.result, null, 2)}</pre>
          </div>
        </div>
      </>
    );
  }
  if (frame.kind === 'tradePlan') {
    const p = frame.data;
    return (
      <>
        <FrameHeader
          title="Final trade plan"
          subtitle="The head trader's binding decision after all specialists chimed in."
          right={<Badge value={p.action} />}
        />
        <div style={kvGrid}>
          <KV label="Conviction" value={p.conviction.toFixed(2)} />
          <KV label="Setup" value={p.setupName ?? '—'} />
          <KV label="Entry" value={`$${p.entry.toFixed(2)}`} />
          <KV label="Stop" value={p.stop ? `$${p.stop.toFixed(2)}` : '—'} />
          <KV label="Target 1" value={p.target1 ? `$${p.target1.toFixed(2)}` : '—'} />
          <KV label="Target 2" value={p.target2 ? `$${p.target2.toFixed(2)}` : '—'} />
          <KV label="Risk %" value={`${(p.riskPctOfEquity * 100).toFixed(2)}%`} />
          <KV label="Risk $" value={`$${p.riskDollars.toFixed(2)}`} />
          <KV label="Shares" value={p.shares.toString()} />
          <KV label="Status" value={<Badge value={p.status} />} />
        </div>
        {p.invalidationCriteria.length > 0 && (
          <>
            <h4 style={{ margin: '12px 0 4px', fontSize: tokens.fontSize.base }}>
              Invalidation criteria
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {p.invalidationCriteria.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </>
        )}
      </>
    );
  }
  if (frame.kind === 'decision') {
    const d = frame.data;
    return (
      <>
        <FrameHeader title="V1 aggregated decision" right={<Badge value={d.decision} />} />
        <div style={kvGrid}>
          <KV label="Weighted score" value={d.weightedScore.toFixed(3)} />
          <KV label="Risk blocked" value={d.riskBlocked ? 'yes' : 'no'} />
          {d.riskReason && <KV label="Risk reason" value={d.riskReason} />}
        </div>
      </>
    );
  }
  return null;
}

function FrameHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: `1px solid ${tokens.color.border}`,
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: tokens.fontSize.lg, fontWeight: 600 }}>{title}</h3>
        {subtitle && (
          <p style={{ margin: '2px 0 0', color: tokens.color.textMuted, fontSize: tokens.fontSize.base }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </header>
  );
}

function FrameDots({ frames, idx, onSelect }: { frames: Frame[]; idx: number; onSelect: (i: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {frames.map((f, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          aria-label={`Jump to ${FRAME_TITLES[f.kind]} ${i + 1}`}
          title={`${i + 1}: ${FRAME_TITLES[f.kind]}`}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            background:
              i === idx
                ? tokens.color.accent
                : i < idx
                  ? tokens.color.borderStrong
                  : tokens.color.border,
          }}
        />
      ))}
    </span>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={miniLabel}>{label}</div>
      <div style={{ fontSize: tokens.fontSize.md, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const kvGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
const miniLabel: React.CSSProperties = {
  fontSize: 10,
  color: tokens.color.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const preStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  background: tokens.color.surfaceMuted,
  border: `1px solid ${tokens.color.border}`,
  padding: 8,
  borderRadius: tokens.radius.sm,
  overflowX: 'auto',
  fontFamily: tokens.font.mono,
};
const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.color.borderStrong}`,
  background: 'white',
  cursor: 'pointer',
  fontSize: tokens.fontSize.base,
  minWidth: 36,
};
