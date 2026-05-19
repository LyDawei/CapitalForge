import { Link } from 'react-router-dom';
import { useCycles } from '../api/hooks';
import { dateTime, ms, usd } from '../lib/format';

export default function Cycles() {
  const { data, isLoading } = useCycles(100);
  return (
    <div>
      <h1 className="page-title">Cycles</h1>
      <p className="page-subtitle">One per (date, symbol). Drill in to see every agent run.</p>
      <div className="card">
        {isLoading ? <div className="empty">Loading…</div> : (
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Symbol</th><th>Status</th><th>Specialists</th>
                <th>Action</th><th>Conviction</th><th>Latency</th><th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data?.cycles.map((c) => (
                <tr key={c.id}>
                  <td>{c.date}</td>
                  <td><Link to={`/cycles/${c.id}`}>{c.symbol}</Link></td>
                  <td><span className={`badge ${c.status === 'completed' ? 'ok' : c.status === 'failed' ? 'danger' : ''}`}>{c.status}</span></td>
                  <td>{c._count.specialistAnalyses}</td>
                  <td>{c.tradePlan?.action ?? '—'}</td>
                  <td>{c.tradePlan ? c.tradePlan.conviction.toFixed(2) : '—'}</td>
                  <td>{ms(c.totalLatencyMs)}</td>
                  <td>{usd(c.totalCostUsd, 4)}</td>
                </tr>
              ))}
              {data?.cycles.length === 0 && <tr><td colSpan={8} className="empty">No cycles yet — run the cycle runner to populate.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
