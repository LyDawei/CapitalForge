import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePresets, useRiskConfig, useStrategyConfig } from '../api/hooks';
import { api } from '../api/client';
import { pct, num } from '../lib/format';

type Tab = 'risk' | 'strategy';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('risk');
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">
        Tune how aggressive the agents are and what strategy they bias toward.
        Every change is recorded — you can always look back at the history.
      </p>

      <div className="tabs">
        <button className={tab === 'risk' ? 'active' : ''} onClick={() => setTab('risk')}>Risk</button>
        <button className={tab === 'strategy' ? 'active' : ''} onClick={() => setTab('strategy')}>Strategy</button>
      </div>

      {tab === 'risk' && <RiskSettings />}
      {tab === 'strategy' && <StrategySettings />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------
function RiskSettings() {
  const presets = usePresets();
  const cur = useRiskConfig();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local editable copy
  type RiskDraft = {
    riskTolerancePct: number;
    maxRiskPctPerTrade: number;
    maxConcurrentPositions: number;
    drawdownHalveAt: number;
    drawdownCloseOnlyAt: number;
    drawdownHardHaltAt: number;
    defaultStopLossPct: number;
    defaultTarget1R: number;
    defaultTarget2R: number;
    defaultTimeStopBars: number;
  };
  const [draft, setDraft] = useState<RiskDraft | null>(null);
  useEffect(() => {
    if (cur.data && !draft) {
      setDraft({
        riskTolerancePct: cur.data.riskTolerancePct,
        maxRiskPctPerTrade: cur.data.maxRiskPctPerTrade,
        maxConcurrentPositions: cur.data.maxConcurrentPositions,
        drawdownHalveAt: cur.data.drawdownHalveAt,
        drawdownCloseOnlyAt: cur.data.drawdownCloseOnlyAt,
        drawdownHardHaltAt: cur.data.drawdownHardHaltAt,
        defaultStopLossPct: cur.data.defaultStopLossPct,
        defaultTarget1R: cur.data.defaultTarget1R,
        defaultTarget2R: cur.data.defaultTarget2R,
        defaultTimeStopBars: cur.data.defaultTimeStopBars,
      });
    }
  }, [cur.data, draft]);

  async function applyPreset(name: string) {
    setSaving(true);
    setError(null);
    try {
      await api('/api/config/risk', { method: 'POST', body: JSON.stringify({ preset: name, reason: `Applied ${name} preset` }) });
      await qc.invalidateQueries({ queryKey: ['risk-config'] });
      setDraft(null);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function saveCustom() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/config/risk', { method: 'POST', body: JSON.stringify({ ...draft, reason: 'Custom edit' }) });
      await qc.invalidateQueries({ queryKey: ['risk-config'] });
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  if (!presets.data || !cur.data || !draft) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="card">
        <h2>Risk presets</h2>
        <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
          Pick one in a single click. You can fine-tune below afterwards.
          Currently active: <strong>{cur.data.presetName}</strong>
        </p>
        <div className="grid cols-3">
          {presets.data.risk.map((p) => (
            <div key={p.name} className="card" style={{ marginBottom: 0, border: cur.data!.presetName === p.name ? '1px solid var(--accent)' : undefined }}>
              <h3 style={{ marginTop: 0 }}>{p.displayName}</h3>
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.description}</p>
              <ul style={{ fontSize: 12, color: 'var(--text-dim)', paddingLeft: 16 }}>
                <li>Max risk per trade: <strong>{((p.values.maxRiskPctPerTrade ?? 0) * 100).toFixed(1)}%</strong></li>
                <li>Max concurrent positions: <strong>{p.values.maxConcurrentPositions ?? '—'}</strong></li>
                <li>Hard halt at <strong>{((p.values.drawdownHardHaltAt ?? 0) * 100).toFixed(0)}%</strong> drawdown</li>
              </ul>
              <button
                onClick={() => applyPreset(p.name)}
                disabled={saving}
                style={{ marginTop: 8, padding: '6px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}
              >
                {cur.data!.presetName === p.name ? 'Currently active' : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Advanced — fine tune</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Editing any value below switches you to a <em>custom</em> config. Each setting is recorded with a timestamp so you can revert.
        </p>
        <div className="grid cols-2" style={{ gap: 16 }}>
          <Knob
            label="Max risk per trade"
            help="The largest % of equity any single trade can lose if its stop hits. Industry standard is 2%."
            value={draft.maxRiskPctPerTrade}
            unit="%"
            multiplier={100}
            min={0.1} max={10} step={0.1}
            onChange={(v) => setDraft({ ...draft, maxRiskPctPerTrade: v / 100 })}
          />
          <Knob
            label="Risk tolerance multiplier"
            help="Scales the agent's emitted risk. 0.7 = be 30% less aggressive. 1.0 = trust the agent."
            value={draft.riskTolerancePct}
            min={0.1} max={2.0} step={0.05}
            onChange={(v) => setDraft({ ...draft, riskTolerancePct: v })}
          />
          <Knob
            label="Max concurrent positions"
            help="How many open trades at once. More = more diversification, but stretches monitoring."
            value={draft.maxConcurrentPositions}
            integer
            min={1} max={20} step={1}
            onChange={(v) => setDraft({ ...draft, maxConcurrentPositions: v })}
          />
          <Knob
            label="Default stop loss"
            help="Used when the head trader doesn't set one. % below entry for longs."
            value={draft.defaultStopLossPct}
            unit="%"
            multiplier={100}
            min={0.5} max={20} step={0.1}
            onChange={(v) => setDraft({ ...draft, defaultStopLossPct: v / 100 })}
          />
          <Knob
            label="Default target 1 (R-multiple)"
            help="First profit target as a multiple of the risked amount. 1.6R = if you risk $100, take profit at $160."
            value={draft.defaultTarget1R}
            min={0.5} max={10} step={0.1}
            onChange={(v) => setDraft({ ...draft, defaultTarget1R: v })}
          />
          <Knob
            label="Default target 2 (R-multiple)"
            help="Second target, usually for a partial exit. Should be > Target 1."
            value={draft.defaultTarget2R}
            min={0.5} max={10} step={0.1}
            onChange={(v) => setDraft({ ...draft, defaultTarget2R: v })}
          />
          <Knob
            label="Time stop (bars)"
            help="If neither stop nor target hits in N bars, close at market. Prevents dead trades from tying up capital."
            value={draft.defaultTimeStopBars}
            integer
            min={1} max={60} step={1}
            onChange={(v) => setDraft({ ...draft, defaultTimeStopBars: v })}
          />
        </div>
        <h3 style={{ marginTop: 24, fontSize: 14 }}>Drawdown ladder</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          As losses accumulate, automatically restrict the agents. Halve sizes → only close existing → hard halt.
        </p>
        <div className="grid cols-3">
          <Knob
            label="Halve sizes at"
            help="At this drawdown %, all new trades are sized 50% smaller."
            value={draft.drawdownHalveAt}
            unit="%"
            multiplier={100}
            min={1} max={30} step={0.5}
            onChange={(v) => setDraft({ ...draft, drawdownHalveAt: v / 100 })}
          />
          <Knob
            label="Close-only at"
            help="At this drawdown %, agents can only close existing positions — no new entries."
            value={draft.drawdownCloseOnlyAt}
            unit="%"
            multiplier={100}
            min={1} max={40} step={0.5}
            onChange={(v) => setDraft({ ...draft, drawdownCloseOnlyAt: v / 100 })}
          />
          <Knob
            label="Hard halt at"
            help="At this drawdown %, all trading stops. Manual reset required."
            value={draft.drawdownHardHaltAt}
            unit="%"
            multiplier={100}
            min={1} max={50} step={0.5}
            onChange={(v) => setDraft({ ...draft, drawdownHardHaltAt: v / 100 })}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={saveCustom} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent-2)', background: 'transparent', color: 'var(--accent-2)', cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save as custom'}
          </button>
          {error && <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------
function StrategySettings() {
  const presets = usePresets();
  const cur = useStrategyConfig();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [holdingPeriod, setHoldingPeriod] = useState<string>('');
  const [avoidEarnings, setAvoidEarnings] = useState<boolean>(true);
  const [avoidWindow, setAvoidWindow] = useState<number>(3);
  const [allocated, setAllocated] = useState<number>(2000);
  const [watchlist, setWatchlist] = useState<string>('');

  useEffect(() => {
    if (cur.data) {
      setHoldingPeriod(cur.data.holdingPeriod);
      setAvoidEarnings(cur.data.avoidEarnings);
      setAvoidWindow(cur.data.avoidEarningsWindowDays);
      setAllocated(cur.data.allocatedCapital);
      setWatchlist(cur.data.watchlist.join(', '));
    }
  }, [cur.data]);

  async function applyPreset(name: string) {
    setSaving(true);
    setError(null);
    try {
      await api('/api/config/strategy', { method: 'POST', body: JSON.stringify({ preset: name, reason: `Applied ${name} preset` }) });
      await qc.invalidateQueries({ queryKey: ['strategy-config'] });
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function saveOther() {
    setSaving(true);
    setError(null);
    try {
      const list = watchlist.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      await api('/api/config/strategy', {
        method: 'POST',
        body: JSON.stringify({
          holdingPeriod,
          avoidEarnings,
          avoidEarningsWindowDays: avoidWindow,
          allocatedCapital: allocated,
          watchlist: list,
          reason: 'Strategy detail edit',
        }),
      });
      await qc.invalidateQueries({ queryKey: ['strategy-config'] });
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  if (!presets.data || !cur.data) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="card">
        <h2>Strategy bias</h2>
        <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
          How the head trader weighs the specialist opinions. Currently active: <strong>{cur.data.strategyBias}</strong>
        </p>
        <div className="grid cols-3">
          {presets.data.strategy.map((p) => (
            <div key={p.name} className="card" style={{ marginBottom: 0, border: cur.data!.strategyBias === p.bias ? '1px solid var(--accent)' : undefined }}>
              <h3 style={{ marginTop: 0 }}>{p.displayName}</h3>
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.description}</p>
              <button
                onClick={() => applyPreset(p.name)}
                disabled={saving}
                style={{ marginTop: 8, padding: '6px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}
              >
                {cur.data!.strategyBias === p.bias ? 'Currently active' : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Other strategy settings</h2>
        <div className="grid cols-2">
          <div>
            <div className="label" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Preferred holding period</div>
            <select value={holdingPeriod} onChange={(e) => setHoldingPeriod(e.target.value)} style={selectStyle}>
              <option value="short_term">Short term (1-3 days)</option>
              <option value="medium_term">Medium term (3-10 days)</option>
              <option value="long_term">Long term (10-30 days)</option>
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Influences the default time stop. Short term = quicker exits; long term = let winners breathe.
            </p>
          </div>

          <div>
            <div className="label" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Allocated capital ($)</div>
            <input type="number" value={allocated} onChange={(e) => setAllocated(+e.target.value)} style={inputStyle} />
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              The sandbox wallet size. Risk % is computed against this. Real money = use Alpaca paper trading first.
            </p>
          </div>

          <div>
            <div className="label" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Watchlist</div>
            <input type="text" value={watchlist} onChange={(e) => setWatchlist(e.target.value)} placeholder="SPY, AAPL, NVDA" style={inputStyle} />
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Comma-separated. These are the symbols the cycle runner iterates. More symbols = more LLM calls/cost.
            </p>
          </div>

          <div>
            <div className="label" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Avoid earnings</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={avoidEarnings} onChange={(e) => setAvoidEarnings(e.target.checked)} />
              Force HOLD when earnings are within
              <input type="number" value={avoidWindow} onChange={(e) => setAvoidWindow(+e.target.value)} style={{ ...inputStyle, width: 60 }} min={0} max={14} />
              days
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Trades held through earnings are basically coin flips on the news. Most disciplined swing traders avoid this.
            </p>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={saveOther} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent-2)', background: 'transparent', color: 'var(--accent-2)', cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {error && <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Knob primitive
// ---------------------------------------------------------------------------
interface KnobProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  multiplier?: number;
  integer?: boolean;
  onChange: (v: number) => void;
}
function Knob({ label, help, value, min, max, step, unit, multiplier, integer, onChange }: KnobProps) {
  const display = multiplier ? value * multiplier : value;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="label" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{integer ? display : num(display, step < 1 ? 2 : 1)}{unit ?? ''}</div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={display}
        onChange={(e) => onChange(multiplier ? +e.target.value / multiplier : +e.target.value)}
        style={{ width: '100%', marginTop: 6 }}
      />
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{help}</p>
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
const selectStyle = inputStyle;
