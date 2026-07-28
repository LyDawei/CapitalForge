export default function AgentBadge({ kind }: { kind: string }) {
  const label = kind.replace('_', ' ');
  return <span className={`badge kind-${kind}`}>{label}</span>;
}
