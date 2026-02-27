import { decisionBgColor, statusBgColor } from '@/lib/utils';

export function DecisionBadge({ decision }: { decision: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${decisionBgColor(decision)}`}>
      {decision}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${statusBgColor(status)}`}>
      {status}
    </span>
  );
}
