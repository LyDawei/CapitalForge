import { Link } from 'react-router-dom';
import { useTrades } from '../api/hooks';
import { num, dateTime } from '../lib/format';

export default function Trades() {
  const { data } = useTrades(100);
  return (
    <div>
      <h1 className="page-title">Trades</h1>
      <p className="page-subtitle">Every proposed plan, plus settled outcomes.</p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>When</th><th>Symbol</th><th>Action</th><th>Entry</th><th>Stop</th>
              <th>Risk %</th><th>Status</th><th>P&amp;L</th><th>R</th>
            </tr>
          </thead>
          <tbody>
            {data?.trades.map((t: any) => (
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
            {data?.trades.length === 0 && <tr><td colSpan={9} className="empty">No trades yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
