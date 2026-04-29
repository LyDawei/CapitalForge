import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRiskConfig,
  updateRiskConfig,
  type RiskConfigValues,
} from '../lib/api-client';
import { InfoPopover, PrimerBlock } from './InfoPopover';
import { Lockable } from './Lockable';
import { tokens, sectionStyle, buttonPrimary, buttonSecondary } from '../theme';

type Knob = {
  key: keyof RiskConfigValues;
  label: string;
  short: string;
  detailed: string;
  example: string;
  unit: 'pct' | 'r' | 'count';
  step: number;
  min: number;
  max: number;
  group: 'risk' | 'drawdown' | 'stop_target';
};

const KNOBS: Knob[] = [
  {
    key: 'riskTolerancePct',
    label: 'Risk tolerance',
    short: 'Multiplier on every trade. 70% means "use 70% of the risk the agents want to take."',
    detailed:
      'A simple dial that scales the risk on every trade up or down. Set it to 100% to let the agents size trades exactly the way they want. Set it lower (e.g. 70%) if you want them to be more cautious without changing any other rule. You can go above 100% (up to 200%) to be more aggressive.',
    example:
      'You set tolerance to 70%. The head trader picks a trade with 1% risk. The system actually sizes it at 0.7% — same setup, less skin in the game.',
    unit: 'pct',
    step: 0.05,
    min: 0,
    max: 2,
    group: 'risk',
  },
  {
    key: 'maxRiskPctPerTrade',
    label: 'Max risk per trade',
    short: 'Hard ceiling on a single trade\'s loss as % of your wallet.',
    detailed:
      'No matter how confident the agents are, a single trade can never risk more than this percent of your total wallet. Professional swing traders typically risk 1–2% per trade. Lower numbers = stronger protection per trade, but smaller wins too.',
    example:
      'Wallet $200, max risk 2% = max loss per trade is $4. If a trade hits its stop, you can\'t lose more than $4 on it.',
    unit: 'pct',
    step: 0.0025,
    min: 0,
    max: 0.05,
    group: 'risk',
  },
  {
    key: 'maxConcurrentPositions',
    label: 'Max open positions',
    short: 'How many trades the engine can have open at once.',
    detailed:
      'Limits how many positions can run simultaneously. Lower = focused, easier to track. Higher = more diversification across symbols. Note: this control is wired into the schema but only fully enforced once M6 (concentration limits) lands.',
    example:
      'Set to 3. The engine holds AAPL, NVDA, and SPY. Even if a fresh BUY signal fires for TSLA, the engine waits until one of the three closes.',
    unit: 'count',
    step: 1,
    min: 1,
    max: 20,
    group: 'risk',
  },
  {
    key: 'drawdownHalveAt',
    label: 'Halve risk at drawdown',
    short: 'When losses hit this %, every new trade gets sized at half the usual risk.',
    detailed:
      'Drawdown is "how far you\'ve fallen from your peak wallet value." Once it crosses this threshold, the engine automatically halves the risk on every new BUY. Defensive mode — preserves capital after a losing streak.',
    example:
      'Wallet peaked at $200, now sitting at $180. Drawdown = (200 − 180) / 200 = 10%. With this set to 10%, a normal 1% risk trade gets sized at 0.5% instead.',
    unit: 'pct',
    step: 0.01,
    min: 0,
    max: 0.5,
    group: 'drawdown',
  },
  {
    key: 'drawdownCloseOnlyAt',
    label: 'Close-only at drawdown',
    short: 'Above this drawdown, no new BUYs at all. Open trades can still close normally.',
    detailed:
      'A harder line than "halve risk." Once drawdown crosses this %, the engine refuses to open any new positions until you recover. Existing trades continue to their stops/targets, but no fresh exposure goes on.',
    example:
      'Set to 15%. Wallet falls from $200 → $170 (15% drawdown). The agents see green setups but the engine forces HOLD — no new positions until the wallet recovers above 15% drawdown.',
    unit: 'pct',
    step: 0.01,
    min: 0,
    max: 0.5,
    group: 'drawdown',
  },
  {
    key: 'drawdownHardHaltAt',
    label: 'Hard halt at drawdown',
    short: 'Total stop. No new trades, no closes, nothing — until you act.',
    detailed:
      'The emergency brake. Above this drawdown, the engine halts everything. You\'ll need to either top up the wallet, change the limit, or manually close positions before it resumes.',
    example:
      'Set to 20%. Wallet falls from $200 → $160. The engine fully halts. Agents stop emitting decisions until you intervene.',
    unit: 'pct',
    step: 0.01,
    min: 0,
    max: 1,
    group: 'drawdown',
  },
  {
    key: 'defaultStopLossPct',
    label: 'Default stop distance',
    short: 'How far below the entry price the stop is placed (as a %).',
    detailed:
      'Every BUY needs a "stop loss" — a price below entry that closes the trade if hit, capping the loss. This is the default distance the engine uses when the LLM doesn\'t pick a structural level (like a recent low). Tighter stops = smaller losses but more false exits. Wider = fewer fake-outs but bigger losses when wrong.',
    example:
      'Stock entry $100, stop distance 5% → stop at $95. If price drops to $95, the trade closes for a $5/share loss.',
    unit: 'pct',
    step: 0.005,
    min: 0,
    max: 0.5,
    group: 'stop_target',
  },
  {
    key: 'defaultTarget1R',
    label: 'Target 1 (R-multiple)',
    short: 'First profit target. "1.6R" means take profit at 1.6× the risk amount.',
    detailed:
      '"R" is shorthand for "the dollar amount you\'re risking on a trade." If your stop is $5/share below entry, then R = $5. Targets are expressed as multiples of R. A 1.6R target means: take profit at 1.6× the distance from entry to stop. The engine fills target1 at this level.',
    example:
      'Entry $100, stop $95 → R = $5. Target 1 at 1.6R = $100 + 1.6 × $5 = $108. If price hits $108, the trade closes for a +$8/share profit (1.6× your risk).',
    unit: 'r',
    step: 0.1,
    min: 0.5,
    max: 10,
    group: 'stop_target',
  },
  {
    key: 'defaultTarget2R',
    label: 'Target 2 (R-multiple)',
    short: 'Second profit target — runner. "3.2R" = take more profit at 3.2× the risk.',
    detailed:
      'A second, more ambitious profit target. Used for "runner" exits — the engine can scale out at Target 1 and let the rest ride to Target 2. Should always be ≥ Target 1.',
    example:
      'Same entry $100, stop $95, R = $5. Target 2 at 3.2R = $100 + 3.2 × $5 = $116. Big winner if hit.',
    unit: 'r',
    step: 0.1,
    min: 0.5,
    max: 20,
    group: 'stop_target',
  },
  {
    key: 'defaultTimeStopBars',
    label: 'Time stop (days in trade)',
    short: 'Max trading days the engine will hold a trade. After that, exit at market.',
    detailed:
      'Even if neither stop nor target is hit, the engine exits after this many trading days. This stops capital from getting stuck in trades that just sit and do nothing. For swing trading, 5–15 days is typical.',
    example:
      'Set to 10. You enter Monday. The engine exits on the 10th trading day (~2 weeks later) regardless of price, freeing up cash for new setups.',
    unit: 'count',
    step: 1,
    min: 1,
    max: 100,
    group: 'stop_target',
  },
];

const GROUP_LABELS: Record<Knob['group'], string> = {
  risk: 'Risk sizing',
  drawdown: 'Drawdown ladder (when to play defense)',
  stop_target: 'Stops & targets (when each trade exits)',
};

function format(value: number, unit: Knob['unit']): string {
  if (unit === 'pct') return `${(value * 100).toFixed(2)}%`;
  if (unit === 'r') return `${value.toFixed(1)}R`;
  return value.toString();
}

export function RiskConfigSection() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['risk-config'], queryFn: fetchRiskConfig });
  const [draft, setDraft] = useState<Partial<RiskConfigValues>>({});
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config.data) setDraft({});
  }, [config.data?.current]);

  const update = useMutation({
    mutationFn: updateRiskConfig,
    onSuccess: () => {
      setError(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['risk-config'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (config.isLoading) return <p>Loading risk config…</p>;
  if (!config.data) return null;

  const current = config.data.current;
  const dirty = Object.keys(draft).length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    update.mutate({
      ...draft,
      reason: reason.trim() || undefined,
      author: author.trim() || undefined,
    });
  };

  const grouped: Record<Knob['group'], Knob[]> = { risk: [], drawdown: [], stop_target: [] };
  KNOBS.forEach((k) => grouped[k.group].push(k));

  return (
    <section style={sectionStyle}>
      <h2 style={{ margin: '0 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>
        Risk &amp; strategy controls
      </h2>
      <p style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.base, margin: '0 0 12px' }}>
        Tune what the agents respect at runtime. Changes apply on the next cycle. Each save is
        recorded so you can track what you changed and when.
      </p>

      <PrimerBlock title="What do these terms mean? (click to expand)">
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          <li>
            <strong>Risk per trade</strong> — the most you can lose on one trade if the stop hits,
            expressed as a % of your wallet. 1–2% is standard for swing trading.
          </li>
          <li>
            <strong>Drawdown</strong> — how far the wallet has fallen from its peak value, as a %.
            If you peaked at $200 and now sit at $180, you are in a 10% drawdown.
          </li>
          <li>
            <strong>R-multiple</strong> — &quot;R&quot; is the dollar amount you are risking on a trade
            (entry price minus stop). A &quot;1.6R target&quot; means take profit at 1.6× that risk amount,
            so you make $1.60 for every $1 you risked.
          </li>
          <li>
            <strong>Conviction</strong> — the head trader&apos;s 0–1 confidence score. Below 0.5 it
            HOLDs; higher conviction → bigger size (capped by Max Risk).
          </li>
          <li>
            <strong>Time stop</strong> — a maximum number of days a trade can run. Stops &quot;dead
            trades&quot; from tying up capital indefinitely.
          </li>
        </ul>
      </PrimerBlock>

      <Lockable label="Risk">
        {({ locked, lock }) => (
      <form onSubmit={(e) => { submit(e); if (dirty) setTimeout(lock, 50); }} style={{ display: 'grid', gap: 16, opacity: locked ? 0.6 : 1 }}>
        {(Object.keys(grouped) as Array<Knob['group']>).map((group) => (
          <fieldset
            key={group}
            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}
          >
            <legend style={{ fontSize: 13, fontWeight: 600, padding: '0 6px' }}>
              {GROUP_LABELS[group]}
            </legend>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 16,
              }}
            >
              {grouped[group].map((knob) => {
                const live = current[knob.key];
                const drafted = draft[knob.key];
                const displayed = drafted ?? live;
                const changed = drafted !== undefined && drafted !== live;
                return (
                  <div key={knob.key} style={{ display: 'grid', gap: 4 }}>
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{knob.label}</span>
                      <InfoPopover
                        short={knob.short}
                        detailed={knob.detailed}
                        example={knob.example}
                      />
                      <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 12 }}>
                        live: {format(live, knob.unit)}
                      </span>
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="range"
                        min={knob.min}
                        max={knob.max}
                        step={knob.step}
                        disabled={locked}
                        value={displayed}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setDraft({ ...draft, [knob.key]: v });
                        }}
                        style={{ flex: 1 }}
                      />
                      <input
                        type="number"
                        value={displayed}
                        disabled={locked}
                        step={knob.step}
                        min={knob.min}
                        max={knob.max}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v)) setDraft({ ...draft, [knob.key]: v });
                        }}
                        style={{
                          width: 90,
                          padding: '4px 6px',
                          fontSize: 12,
                          fontFamily: tokens.font.mono,
                          border: `1px solid ${changed ? '#f59e0b' : tokens.color.borderStrong}`,
                          borderRadius: tokens.radius.sm,
                          background: locked ? tokens.color.lockedBg : 'white',
                          color: locked ? tokens.color.locked : tokens.color.text,
                        }}
                      />
                      {changed && (
                        <span
                          style={{
                            fontSize: 11,
                            color: '#92400e',
                            background: '#fef3c7',
                            padding: '1px 6px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {format(live, knob.unit)} → {format(displayed, knob.unit)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.45 }}>
                      {knob.short}
                    </span>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div
          style={{
            display: 'grid',
            gap: 8,
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: 12,
          }}
        >
          <input
            type="text"
            disabled={locked}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (e.g. 'taking risk down after Friday's drawdown')"
            style={{
              padding: '6px 8px',
              borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.color.borderStrong}`,
              fontSize: tokens.fontSize.base,
              background: locked ? tokens.color.lockedBg : 'white',
              color: locked ? tokens.color.locked : tokens.color.text,
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              disabled={locked}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name (so you remember who changed it)"
              style={{
                flex: '0 0 240px',
                padding: '6px 8px',
                borderRadius: tokens.radius.sm,
                border: `1px solid ${tokens.color.borderStrong}`,
                fontSize: tokens.fontSize.base,
                background: locked ? tokens.color.lockedBg : 'white',
                color: locked ? tokens.color.locked : tokens.color.text,
              }}
            />
            <button
              type="submit"
              disabled={locked || !dirty || update.isPending}
              style={{
                ...buttonPrimary,
                opacity: locked || !dirty || update.isPending ? 0.5 : 1,
                cursor: locked || !dirty ? 'not-allowed' : 'pointer',
              }}
            >
              {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
            </button>
            <button
              type="button"
              onClick={() => setDraft({})}
              disabled={locked || !dirty}
              style={{
                ...buttonSecondary,
                opacity: locked || !dirty ? 0.5 : 1,
                cursor: locked || !dirty ? 'not-allowed' : 'pointer',
              }}
            >
              Reset
            </button>
            {error && (
              <span style={{ color: tokens.color.danger, fontSize: tokens.fontSize.base }}>
                {error}
              </span>
            )}
          </div>
        </div>
      </form>
        )}
      </Lockable>

      {config.data.history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#374151' }}>
            History ({config.data.history.length})
          </summary>
          <table style={{ marginTop: 8, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>When</th>
                <th style={th}>Risk tol.</th>
                <th style={th}>Max risk/trade</th>
                <th style={th}>Stop %</th>
                <th style={th}>T1 / T2</th>
                <th style={th}>DD ladder</th>
                <th style={th}>Reason</th>
                <th style={th}>Author</th>
              </tr>
            </thead>
            <tbody>
              {config.data.history.map((h) => (
                <tr key={h.id}>
                  <td style={td}>{new Date(h.createdAt).toLocaleString()}</td>
                  <td style={td}>{(h.riskTolerancePct * 100).toFixed(0)}%</td>
                  <td style={td}>{(h.maxRiskPctPerTrade * 100).toFixed(2)}%</td>
                  <td style={td}>{(h.defaultStopLossPct * 100).toFixed(1)}%</td>
                  <td style={td}>
                    {h.defaultTarget1R}R / {h.defaultTarget2R}R
                  </td>
                  <td style={td}>
                    {(h.drawdownHalveAt * 100).toFixed(0)}/
                    {(h.drawdownCloseOnlyAt * 100).toFixed(0)}/
                    {(h.drawdownHardHaltAt * 100).toFixed(0)}%
                  </td>
                  <td style={td}>{h.reason ?? '—'}</td>
                  <td style={td}>{h.author ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};
const td: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #f3f4f6',
};
