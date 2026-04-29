import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchAgentSummaries, type AgentSummaryCard } from '../lib/api-client';
import { Badge } from '../components/Badges';
import { Sparkline } from '../components/Sparkline';
import { tokens, sectionStyle } from '../theme';

export function Agents() {
  const agents = useQuery({
    queryKey: ['agent-summaries'],
    queryFn: fetchAgentSummaries,
    refetchInterval: 60_000,
  });

  if (agents.isLoading) return <p>Loading…</p>;
  if (agents.isError) return <p style={{ color: 'crimson' }}>{(agents.error as Error).message}</p>;
  if (!agents.data) return null;

  const headTrader = agents.data.find((a) => a.kind === 'head_trader');
  const v2Specialists = agents.data.filter((a) => a.engineVersion === 'v2' && a.kind === 'specialist');
  const v1Agents = agents.data.filter((a) => a.engineVersion === 'v1');

  const totalRuns = agents.data.reduce((sum, a) => sum + a.stats.totalRuns, 0);

  return (
    <section style={sectionStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>
            Agents
          </h2>
          <p style={{ margin: 0, color: tokens.color.textMuted, fontSize: tokens.fontSize.base }}>
            Every LLM-driven agent in the system. Click a card to see its prompt, performance, and notes.
          </p>
        </div>
        <span style={{ fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
          {agents.data.length} agents · {totalRuns} total runs
        </span>
      </div>

      {headTrader && (
        <SubSection title="Head trader" subtitle="Reads all specialist reports and emits the final trade plan.">
          <Grid>
            <AgentCard agent={headTrader} />
          </Grid>
        </SubSection>
      )}

      <SubSection
        title={`V2 specialists (${v2Specialists.length})`}
        subtitle="Each specialist analyzes one dimension of the setup and feeds the head trader."
      >
        <Grid>
          {v2Specialists.map((a) => <AgentCard key={`${a.engineVersion}-${a.name}`} agent={a} />)}
        </Grid>
      </SubSection>

      <SubSection
        title={`V1 agents (${v1Agents.length})`}
        subtitle="Legacy parallel agents — scheduled for removal once V2 checks out."
      >
        <Grid>
          {v1Agents.map((a) => <AgentCard key={`${a.engineVersion}-${a.name}`} agent={a} />)}
        </Grid>
      </SubSection>
    </section>
  );
}

function SubSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 2px', fontSize: tokens.fontSize.lg, fontWeight: 600 }}>{title}</h3>
      {subtitle && (
        <p style={{ margin: '0 0 10px', color: tokens.color.textMuted, fontSize: tokens.fontSize.sm }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function AgentCard({ agent: a }: { agent: AgentSummaryCard }) {
  const detailHref = `/agents/${encodeURIComponent(`${a.name}-${a.engineVersion}`)}`;
  const winRate = a.outcomes.winRate;

  // Score sparkline range — for specialists it's [-1, 1], for head trader it's [0, 1] (conviction).
  // We feed raw values; Sparkline scales to the series.
  const scoreColor =
    a.recentScores.length === 0
      ? tokens.color.textSubtle
      : a.recentScores[a.recentScores.length - 1] >= 0.4
        ? tokens.color.success
        : a.recentScores[a.recentScores.length - 1] <= -0.4
          ? tokens.color.danger
          : tokens.color.text;

  return (
    <Link
      to={detailHref}
      style={{
        display: 'block',
        background: tokens.color.surface,
        border: `1px solid ${a.engineVersion === 'v1' ? '#e9d5ff' : tokens.color.border}`,
        borderRadius: tokens.radius.md,
        padding: 14,
        boxShadow: tokens.shadow.card,
        textDecoration: 'none',
        color: tokens.color.text,
        transition: 'box-shadow 120ms, transform 120ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = tokens.shadow.elevated;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = tokens.shadow.card;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 6,
          marginBottom: 6,
        }}
      >
        <strong
          style={{
            fontSize: tokens.fontSize.lg,
            letterSpacing: 0.1,
            lineHeight: 1.25,
          }}
        >
          {a.displayName}
        </strong>
        <Badge value={a.engineVersion} />
      </header>

      <p
        style={{
          margin: '0 0 10px',
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.base,
          lineHeight: 1.4,
          minHeight: 36,
        }}
      >
        {a.role}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <span style={miniLabel}>
            {a.kind === 'head_trader' ? 'Recent conviction' : 'Recent scores'}
          </span>
          <span style={{ fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
            {a.recentScores.length === 0 ? 'no runs yet' : `${a.recentScores.length} samples`}
          </span>
        </div>
        <Sparkline
          values={a.recentScores}
          width={120}
          height={32}
          stroke={scoreColor}
          fill={scoreColor}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          padding: '8px 10px',
          background: tokens.color.surfaceMuted,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.fontSize.sm,
          marginBottom: 10,
        }}
      >
        <Stat label="Runs" value={a.stats.totalRuns.toString()} />
        <Stat
          label="Last seen"
          value={a.lastSeen ? formatRelative(a.lastSeen) : '—'}
          tone="muted"
        />
        <Stat
          label="Win rate"
          value={
            a.engineVersion === 'v1'
              ? 'n/a (V1)'
              : winRate === null
                ? '—'
                : `${(winRate * 100).toFixed(0)}%`
          }
          tone={
            a.engineVersion === 'v1' || winRate === null
              ? 'muted'
              : winRate >= 0.5
                ? 'good'
                : 'bad'
          }
        />
        <Stat
          label="Total R"
          value={
            a.outcomes.settled === 0
              ? '—'
              : `${a.outcomes.totalR >= 0 ? '+' : ''}${a.outcomes.totalR.toFixed(2)}R`
          }
          tone={
            a.outcomes.settled === 0
              ? 'muted'
              : a.outcomes.totalR >= 0
                ? 'good'
                : 'bad'
          }
        />
      </div>

      {a.lastCycleId ? (
        <Link
          to={`/cycles/${a.lastCycleId}/replay`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '6px 10px',
            borderRadius: tokens.radius.sm,
            background: tokens.color.accent,
            color: tokens.color.accentText,
            fontSize: tokens.fontSize.sm,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          ▶ Watch latest deliberation
        </Link>
      ) : (
        <div
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '6px 10px',
            borderRadius: tokens.radius.sm,
            background: tokens.color.lockedBg,
            color: tokens.color.locked,
            fontSize: tokens.fontSize.sm,
          }}
        >
          ▶ No runs to replay yet
        </div>
      )}
    </Link>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad' | 'muted';
}) {
  const color =
    tone === 'good'
      ? tokens.color.success
      : tone === 'bad'
        ? tokens.color.danger
        : tone === 'muted'
          ? tokens.color.textSubtle
          : tokens.color.text;
  return (
    <div>
      <div style={miniLabel}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  fontSize: 10,
  color: tokens.color.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
