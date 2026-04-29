import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWallet, updateAllocation } from '../lib/api-client';
import { InfoPopover, PrimerBlock } from './InfoPopover';
import { Lockable } from './Lockable';
import { tokens, sectionStyle, buttonPrimary } from '../theme';

export function WalletSection() {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet });

  const [newAmount, setNewAmount] = useState<string>('');
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: updateAllocation,
    onSuccess: () => {
      setError(null);
      setNewAmount('');
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-state'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(newAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Enter a non-negative number');
      return;
    }
    update.mutate({
      allocatedCapital: amt,
      reason: reason.trim() || undefined,
      author: author.trim() || undefined,
    });
  };

  if (wallet.isLoading) return <p>Loading wallet…</p>;
  if (!wallet.data) return null;

  const current = wallet.data.allocation;
  const sandbox = wallet.data.sandbox;
  const previewDelta =
    newAmount && current ? parseFloat(newAmount) - current.allocatedCapital : null;

  return (
    <section style={sectionStyle}>
      <h2 style={{ margin: '0 0 4px', fontSize: tokens.fontSize.h2, fontWeight: 600 }}>Wallet</h2>
      <p style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.base, margin: '0 0 12px' }}>
        Agents are restricted to the allocated capital below. This is the only money they can use.
      </p>

      <PrimerBlock title="How does the wallet work? (click to expand)">
        <p style={{ margin: '4px 0' }}>
          The wallet is a fixed budget you give to the agents. They can never spend more than what
          you allocate.
        </p>
        <p style={{ margin: '4px 0' }}>
          Updates apply as a <strong>delta</strong>, not a reset. If you go from $200 → $300, the
          agents keep whatever they have already spent and just gain $100 of new buying power.
          They never get a fresh $300 dropped on them.
        </p>
        <p style={{ margin: '4px 0' }}>
          Reducing the allocation only works if there is enough cash on hand to cover the
          reduction. The system will not force-close a trade just to honor a withdrawal.
        </p>
        <p style={{ margin: '4px 0', fontSize: 12, color: tokens.color.info }}>
          Wallet adjustments do not count as agent profit/loss — drawdown tracking ignores them.
        </p>
      </PrimerBlock>

      <div style={cardGrid}>
        <Stat
          label="Current allocation"
          value={current ? `$${current.allocatedCapital.toFixed(2)}` : 'Not yet set'}
          info={
            <InfoPopover
              short="The total budget you've given the agents."
              detailed="The maximum amount of money the agents are allowed to control. Cash + open position value should never exceed this."
              example="Set to $200. Agents have $200 to work with — split between cash and any open positions."
            />
          }
        />
        <Stat
          label="Cash available"
          value={sandbox ? `$${sandbox.cashBalance.toFixed(2)}` : '—'}
          info={
            <InfoPopover
              short="Money sitting unused that the agents can spend on a new trade."
              detailed="When the agents open a position, cash goes down. When a position closes, cash goes back up (with profit or loss). This is what's available right now to take a new trade."
              example="Allocation $200, holding 6 shares × $30 = $180 in a position → cash = $20."
            />
          }
        />
        <Stat
          label="Equity"
          value={sandbox ? `$${sandbox.currentEquity.toFixed(2)}` : '—'}
          info={
            <InfoPopover
              short="Total wallet value: cash + positions marked at current price."
              detailed="The real-time value of everything the agents own. If a position has gained value, equity > allocation. If it has lost value, equity < allocation. This is the number that matters for drawdown."
              example="Allocation $200, cash $20, position now worth $190 → equity = $210 (you're up $10)."
            />
          }
        />
        <Stat
          label="Last change"
          value={current ? new Date(current.createdAt).toLocaleString() : '—'}
        />
      </div>

      <Lockable label="Wallet">
        {({ locked, lock }) => (
          <form
            onSubmit={(e) => {
              submit(e);
              if (newAmount) setTimeout(lock, 50);
            }}
            style={{
              marginTop: 4,
              display: 'grid',
              gap: 8,
              background: tokens.color.surfaceMuted,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              padding: 12,
              opacity: locked ? 0.6 : 1,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: tokens.fontSize.base }}>
                New allocation $
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={locked}
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  style={{ ...fieldBase(locked), width: 140, marginLeft: 6 }}
                  placeholder={current ? current.allocatedCapital.toString() : '200'}
                />
              </label>
              {previewDelta !== null && previewDelta !== 0 && (
                <span
                  style={{
                    fontSize: tokens.fontSize.base,
                    fontWeight: 500,
                    color: previewDelta > 0 ? tokens.color.success : tokens.color.danger,
                  }}
                >
                  {previewDelta > 0
                    ? `+$${previewDelta.toFixed(2)} added to cash`
                    : `−$${Math.abs(previewDelta).toFixed(2)} removed from cash`}
                </span>
              )}
            </div>
            <input
              type="text"
              disabled={locked}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, e.g. 'topping up after good week')"
              style={fieldBase(locked)}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                disabled={locked}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Author (optional)"
                style={{ ...fieldBase(locked), flex: '0 0 220px' }}
              />
              <button
                type="submit"
                disabled={locked || !newAmount || update.isPending}
                style={{
                  ...buttonPrimary,
                  opacity: locked || !newAmount || update.isPending ? 0.5 : 1,
                  cursor: locked || !newAmount ? 'not-allowed' : 'pointer',
                }}
              >
                {update.isPending ? 'Saving…' : 'Update allocation'}
              </button>
              {error && (
                <span style={{ color: tokens.color.danger, fontSize: tokens.fontSize.base }}>
                  {error}
                </span>
              )}
            </div>
          </form>
        )}
      </Lockable>

      {wallet.data.history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: tokens.fontSize.base, color: tokens.color.text }}>
            History ({wallet.data.history.length})
          </summary>
          <table
            style={{
              marginTop: 8,
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: tokens.fontSize.base,
            }}
          >
            <thead>
              <tr style={{ background: tokens.color.surfaceMuted }}>
                <th style={th}>When</th>
                <th style={th}>New total</th>
                <th style={th}>Delta</th>
                <th style={th}>Reason</th>
                <th style={th}>Author</th>
              </tr>
            </thead>
            <tbody>
              {wallet.data.history.map((h) => (
                <tr key={h.id}>
                  <td style={td}>{new Date(h.createdAt).toLocaleString()}</td>
                  <td style={td}>${h.allocatedCapital.toFixed(2)}</td>
                  <td
                    style={{
                      ...td,
                      color: h.delta > 0 ? tokens.color.success : h.delta < 0 ? tokens.color.danger : tokens.color.text,
                      fontFamily: tokens.font.mono,
                    }}
                  >
                    {h.delta > 0 ? '+' : ''}${h.delta.toFixed(2)}
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

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 12,
};

function fieldBase(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 8px',
    borderRadius: tokens.radius.sm,
    border: `1px solid ${disabled ? tokens.color.border : tokens.color.borderStrong}`,
    fontSize: tokens.fontSize.base,
    background: disabled ? tokens.color.lockedBg : 'white',
    color: disabled ? tokens.color.locked : tokens.color.text,
    width: '100%',
  };
}

function Stat({
  label,
  value,
  info,
}: {
  label: string;
  value: string;
  info?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: tokens.color.surfaceMuted,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          fontSize: tokens.fontSize.xs,
          color: tokens.color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
        {info}
      </div>
      <div style={{ fontSize: tokens.fontSize.xl, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: tokens.fontSize.xs,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: tokens.color.text,
  borderBottom: `1px solid ${tokens.color.border}`,
};
const td: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: `1px solid ${tokens.color.surfaceMuted}`,
};
