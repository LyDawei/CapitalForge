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
          There's no universal target — <strong>~50% is the "no relationship" baseline</strong> (independent
          signals agree by chance about half the time). Near 100% means the pair moves together (possibly
          redundant); near 0% means they're systematically calling the opposite direction, which is its own
          strong relationship, not the same as healthy diversity. Compare each pair's number to what you'd
          expect given what the two specialists actually measure, and watch for surprises or sudden shifts
          over time rather than chasing a specific percentage.
        </p>
        {isLoading ? <div className="empty">Loading…</div> : data && <AgreementMatrix data={data} />}
      </div>
    </div>
  );
}
