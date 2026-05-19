import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet, useWalletTransactions, type WalletTransaction, type WalletTxKind } from '../api/hooks';
import { api, ApiError } from '../api/client';
import { dateTime } from '../lib/format';

export default function Wallet() {
  const wallet = useWallet();
  const txs = useWalletTransactions(100, 0);

  return (
    <div>
      <h1 className="page-title">Wallet</h1>
      <p className="page-subtitle">
        Persistent shared capital ledger. Deposits add — they never overwrite. The settler
        auto-books realized P&amp;L from closed trades. Balance = sum of every transaction.
      </p>

      <div className="grid cols-2" style={{ gap: 16 }}>
        <BalanceCard wallet={wallet.data} loading={wallet.isLoading} />
        <DepositWithdrawForm />
      </div>

      <div className="card">
        <h2>Ledger</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Append-only. Every entry has an author + reason. Settler entries link back to the
          TradePlan that produced them.
        </p>
        {txs.isLoading ? (
          <div className="empty">Loading…</div>
        ) : !txs.data || txs.data.transactions.length === 0 ? (
          <div className="empty">No transactions yet — deposit to fund the wallet.</div>
        ) : (
          <TransactionsTable rows={txs.data.transactions} />
        )}
      </div>
    </div>
  );
}

function BalanceCard({ wallet, loading }: { wallet: { balance: number } | undefined; loading: boolean }) {
  if (loading) return <div className="card empty">Loading…</div>;
  const balance = wallet?.balance ?? 0;
  const positive = balance >= 0;
  return (
    <div
      className="card"
      style={{
        borderColor: positive ? 'var(--accent)' : 'var(--danger)',
        marginBottom: 0,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Current balance</h2>
      <div
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: positive ? 'var(--accent)' : 'var(--danger)',
        }}
      >
        ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 0 }}>
        This is what the head trader sees as available capital. Risk-per-trade is sized against
        this number, not the legacy <code>StrategyConfig.allocatedCapital</code>.
      </p>
    </div>
  );
}

function DepositWithdrawForm() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<WalletTxKind>('deposit');
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMessage(null);
    const raw = Number(amountStr);
    if (!Number.isFinite(raw) || raw <= 0) {
      setError('Amount must be a positive number');
      setBusy(false);
      return;
    }
    // Withdrawals are signed negative server-side; the user enters a positive
    // magnitude in the form and the client flips it for withdrawal/adjustment.
    const signedAmount = kind === 'deposit' ? raw : -raw;
    try {
      await api('/api/wallet/transactions', {
        method: 'POST',
        body: JSON.stringify({
          kind: kind === 'adjustment' ? 'adjustment' : kind,
          amount: signedAmount,
          reason,
          author,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['wallet'] });
      await qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
      setOkMessage(`${kind === 'deposit' ? 'Deposited' : kind === 'withdrawal' ? 'Withdrew' : 'Adjusted'} $${raw.toFixed(2)}.`);
      setAmountStr('');
      setReason('');
    } catch (e: any) {
      if (e instanceof ApiError) setError(e.body?.message ?? e.message);
      else setError(e.message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card" style={{ marginBottom: 0 }}>
      <h2 style={{ marginTop: 0 }}>Move money</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
        Deposits add to the existing balance; withdrawals subtract. Every action is signed by
        you and reason-tagged so the ledger explains itself.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Action">
          <select value={kind} onChange={(e) => setKind(e.target.value as WalletTxKind)} style={inputStyle}>
            <option value="deposit">Deposit (add)</option>
            <option value="withdrawal">Withdraw (subtract)</option>
            <option value="adjustment">Adjustment (signed)</option>
          </select>
        </Field>
        <Field label="Amount ($)">
          <input
            type="number"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="50.00"
            style={inputStyle}
            required
          />
        </Field>
        <Field label="Reason">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Top-up for week 3 testing"
            style={inputStyle}
            required
          />
        </Field>
        <Field label="Author (who's making this change)">
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="david"
            style={inputStyle}
            required
          />
        </Field>
        <div>
          <button
            type="submit"
            disabled={busy || !amountStr || !reason || !author}
            style={btnStyle('var(--accent)')}
          >
            {busy ? 'Submitting…' : kind === 'deposit' ? 'Deposit' : kind === 'withdrawal' ? 'Withdraw' : 'Adjust'}
          </button>
          {error && <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{error}</span>}
          {okMessage && <span style={{ marginLeft: 12, color: 'var(--accent)' }}>{okMessage}</span>}
        </div>
      </div>
    </form>
  );
}

function TransactionsTable({ rows }: { rows: WalletTransaction[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Kind</th>
          <th style={{ textAlign: 'right' }}>Amount</th>
          <th>Reason</th>
          <th>Author</th>
          <th>Trade plan</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{dateTime(t.createdAt)}</td>
            <td>
              <span className="badge" style={{ ...kindBadgeStyle(t.kind) }}>
                {t.kind.replace('_', ' ')}
              </span>
            </td>
            <td
              style={{
                textAlign: 'right',
                fontFamily: 'monospace',
                color: t.amount >= 0 ? 'var(--accent)' : 'var(--danger)',
                fontWeight: 600,
              }}
            >
              {t.amount >= 0 ? '+' : ''}
              {t.amount.toFixed(2)}
            </td>
            <td>{t.reason}</td>
            <td style={{ color: 'var(--text-dim)' }}>{t.author}</td>
            <td>
              {t.tradePlanId ? (
                <code style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {t.tradePlanId.slice(0, 8)}…
                </code>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function kindBadgeStyle(kind: WalletTxKind): React.CSSProperties {
  switch (kind) {
    case 'deposit':
      return { background: 'rgba(127,200,169,0.15)', color: 'var(--accent)' };
    case 'withdrawal':
      return { background: 'rgba(239,107,115,0.12)', color: 'var(--danger)' };
    case 'trade_settlement':
      return { background: 'rgba(127,200,169,0.10)', color: 'var(--accent-2)' };
    case 'adjustment':
      return { background: 'rgba(180,180,180,0.10)', color: 'var(--text-dim)' };
  }
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
  width: '100%',
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
