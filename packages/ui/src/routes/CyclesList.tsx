import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchSymbolSummaries, type SymbolDetailedSummary } from '../lib/api-client';
import { Badge } from '../components/Badges';
import { Sparkline } from '../components/Sparkline';
import { InfoPopover } from '../components/InfoPopover';
import { tokens, sectionStyle } from '../theme';

export function CyclesList() {
  const summaries = useQuery({
    queryKey: ['symbol-summaries'],
    queryFn: fetchSymbolSummaries,
    refetchInterval: 60_000,
  });

  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>Cycles by symbol</h2>
          <p style={{ margin: 0, color: tokens.color.textMuted, fontSize: tokens.fontSize.base }}>
            One card per symbol the engine has run on. Click a card to see every cycle for that
            symbol in chronological order.
          </p>
        </div>
        {summaries.data && (
          <span style={{ fontSize: tokens.fontSize.sm, color: tokens.color.textMuted }}>
            {summaries.data.length} symbols · {summaries.data.reduce((s, x) => s + x.cycleCount, 0)} total cycles
          </span>
        )}
      </div>

      {summaries.isLoading && <p style={{ marginTop: 16 }}>Loading…</p>}
      {summaries.data && summaries.data.length === 0 && (
        <p style={{ marginTop: 16, color: tokens.color.textMuted }}>
          No cycles yet. Run <code>npm run run-cycle -w @capitalforge/engine -- --date YYYY-MM-DD</code>.
        </p>
      )}
      {summaries.data && summaries.data.length > 0 && (
        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {summaries.data.map((s) => <SymbolCard key={s.symbol} summary={s} />)}
        </div>
      )}
    </section>
  );
}

function SymbolCard({ summary: s }: { summary: SymbolDetailedSummary }) {
  const winRate = s.outcomes.winRate;
  const dirColor =
    s.recentCloses.length >= 2 &&
    s.recentCloses[s.recentCloses.length - 1] >= s.recentCloses[0]
      ? tokens.color.success
      : tokens.color.danger;

  return (
    <Link
      to={`/cycles/symbol/${encodeURIComponent(s.symbol)}`}
      style={{
        display: 'block',
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
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
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ fontSize: 18, letterSpacing: 0.2 }}>{s.symbol}</strong>
        {s.latestCycle?.action && <Badge value={s.latestCycle.action} />}
      </header>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <span
            style={{
              fontSize: 10,
              color: tokens.color.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Stock price (last close)
            <span onClick={(e) => e.preventDefault()}>
              <InfoPopover
                short="The stock's last closing price — not your wallet."
                detailed="This is the price of one share of this stock the most recent time the engine ran a cycle for it. It reflects the market — it has nothing to do with how much money you have."
                example="AAPL last close = $188.54 means AAPL was trading at $188.54 per share. Your wallet balance is on the Dashboard."
              />
            </span>
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              fontFamily: tokens.font.mono,
              color: dirColor,
            }}
          >
            ${s.latestCycle?.close.toFixed(2) ?? '—'}
          </span>
          <span style={{ fontSize: tokens.fontSize.xs, color: tokens.color.textMuted }}>
            as of {s.latestCycle?.date ?? '—'}
          </span>
        </div>
        <Sparkline values={s.recentCloses} width={110} height={36} stroke={dirColor} fill={dirColor} />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          marginBottom: 8,
          borderRadius: tokens.radius.sm,
          background: s.myPosition ? '#ecfdf5' : tokens.color.surfaceMuted,
          border: `1px solid ${s.myPosition ? '#a7f3d0' : tokens.color.border}`,
          fontSize: tokens.fontSize.sm,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: tokens.color.textMuted, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5 }}>
            Your position
          </span>
          <span onClick={(e) => e.preventDefault()}>
            <InfoPopover
              short="Whether your wallet currently holds shares of this stock."
              detailed="The agents can hold one position at a time across all symbols. If they have an open trade in this symbol, it shows here. 'Flat' means you don't currently own any shares of this stock."
              example="6 shares · $640 means you own 6 AAPL shares with a current market value of $640. Flat = no shares right now."
            />
          </span>
        </span>
        {s.myPosition ? (
          <span
            style={{
              fontFamily: tokens.font.mono,
              fontWeight: 600,
              color:
                s.myPosition.unrealizedPnl !== null && s.myPosition.unrealizedPnl >= 0
                  ? tokens.color.success
                  : tokens.color.danger,
            }}
          >
            {s.myPosition.shares} sh · ${s.myPosition.marketValue.toFixed(2)}
            {s.myPosition.unrealizedPnl !== null && (
              <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11 }}>
                ({s.myPosition.unrealizedPnl >= 0 ? '+' : ''}${s.myPosition.unrealizedPnl.toFixed(2)})
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: tokens.color.textMuted, fontWeight: 500 }}>Flat</span>
        )}
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
        }}
      >
        <Stat label="Cycles" value={s.cycleCount.toString()} />
        <Stat
          label="Conviction"
          value={s.latestCycle?.conviction !== null && s.latestCycle?.conviction !== undefined
            ? s.latestCycle.conviction.toFixed(2)
            : '—'}
        />
        <Stat
          label="Win rate"
          value={winRate === null ? '—' : `${(winRate * 100).toFixed(0)}%`}
          tone={winRate === null ? 'muted' : winRate >= 0.5 ? 'good' : 'bad'}
        />
        <Stat
          label="Total R"
          value={
            s.outcomes.settled === 0
              ? '—'
              : `${s.outcomes.totalR >= 0 ? '+' : ''}${s.outcomes.totalR.toFixed(2)}R`
          }
          tone={
            s.outcomes.settled === 0
              ? 'muted'
              : s.outcomes.totalR >= 0
                ? 'good'
                : 'bad'
          }
        />
      </div>

      <p style={{ margin: '8px 0 0', fontSize: 11, color: tokens.color.textSubtle }}>
        Last seen: {new Date(s.lastSeen).toLocaleString()}
      </p>
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
      <div style={{ fontSize: 10, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
