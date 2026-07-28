import { Link } from 'react-router-dom';
import { useTrades } from '../api/hooks';
import MetricCard from '../components/MetricCard';
import TradesPnlChart from '../components/TradesPnlChart';
import InfoTooltip from '../components/InfoTooltip';
import { num, pct, dateTime } from '../lib/format';

export default function Trades() {
  const { data } = useTrades(100);
  const trades = data?.trades ?? [];
  const settled = trades.filter((t: any) => t.outcome !== null);
  const wins = settled.filter((t: any) => t.outcome.realizedPnl > 0).length;
  const losses = settled.filter((t: any) => t.outcome.realizedPnl < 0).length;
  const breakeven = settled.filter((t: any) => t.outcome.realizedPnl === 0).length;
  const winRate = settled.length > 0 ? wins / settled.length : null;

  return (
    <div>
      <h1 className="page-title">Trades</h1>
      <p className="page-subtitle">Every proposed plan, plus settled outcomes.</p>

      <div className="grid cols-3">
        <MetricCard label="Wins" value={`${wins}`} sub={winRate !== null ? `${pct(winRate)} win rate` : undefined} tone="ok" />
        <MetricCard label="Losses" value={`${losses}`} tone="danger" />
        <MetricCard label="Breakeven" value={`${breakeven}`} tone="warn" />
      </div>

      <div className="card">
        <h2>Cumulative P&amp;L</h2>
        <TradesPnlChart trades={trades} />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>When</th><th>Symbol</th><th>Action</th><th>Entry</th><th>Stop</th>
              <th>Risk % <InfoTooltip text="% of account equity that would be lost if the stop is hit — the position is sized to cap the loss at this percentage." /></th>
              <th>Status</th><th>P&amp;L</th>
              <th>R <InfoTooltip align="right" text="R-multiple: P&L as a multiple of the risk taken. R=1 means the trade made exactly what was risked; R=-1 means the full risked amount was lost." /></th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any) => (
              <tr key={t.id}>
                <td>{dateTime(t.createdAt)}</td>
                <td><Link to={`/cycles/${t.cycleId}`}>{t.symbol}</Link></td>
                <td>{t.action}</td>
                <td>{num(t.entry)}</td>
                <td>{num(t.stop)}</td>
                <td>{num((t.riskPctOfEquity ?? 0) * 100)}%</td>
                <td><span className={`badge ${t.status === 'closed' ? 'ok' : ''}`}>{t.status}</span></td>
                <td>{num(t.outcome?.realizedPnl)}</td>
                <td>{num(t.outcome?.rMultiple)}</td>
              </tr>
            ))}
            {trades.length === 0 && <tr><td colSpan={9} className="empty">No trades yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
