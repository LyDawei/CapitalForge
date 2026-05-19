import { useAgreement } from '../api/hooks';
import AgreementMatrix from '../components/AgreementMatrix';

export default function Audit() {
  const { data, isLoading } = useAgreement();
  return (
    <div>
      <h1 className="page-title">Audit</h1>
      <p className="page-subtitle">
        System-wide views: which specialists agree, which fight, and where the signal redundancy lives.
      </p>

      <div className="card">
        <h2>Specialist agreement matrix</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          % of cycles where two specialists agreed on direction (sign of bullishScore).
          High = redundant signal. Low = orthogonal signal.
        </p>
        {isLoading ? <div className="empty">Loading…</div> : data && <AgreementMatrix data={data} />}
      </div>
    </div>
  );
}
