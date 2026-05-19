import { Link } from 'react-router-dom';
import { useAgents, usePredictionScores } from '../api/hooks';
import AgentBadge from '../components/AgentBadge';
import { PredictionBadge } from '../components/PredictionBadge';

export default function Agents() {
  const { data, isLoading } = useAgents();
  const predictions = usePredictionScores();
  const predMap = new Map((predictions.data ?? []).map((p) => [p.agentName, p]));

  return (
    <div>
      <h1 className="page-title">Agents</h1>
      <p className="page-subtitle">Specialists, the head trader, and the auditing red team.</p>
      <div className="card">
        {isLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Role</th>
                <th>Prediction</th>
                <th>Runs</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((a) => {
                const p = predMap.get(a.name);
                return (
                  <tr key={a.id}>
                    <td><Link to={`/agents/${a.name}`}>{a.displayName}</Link></td>
                    <td><AgentBadge kind={a.kind} /></td>
                    <td style={{ color: 'var(--text-dim)' }}>{a.role}</td>
                    <td>{p ? <PredictionBadge score={p} /> : '—'}</td>
                    <td>{a._count?.runs ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
