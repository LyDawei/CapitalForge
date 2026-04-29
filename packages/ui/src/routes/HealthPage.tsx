import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api-client';

export function HealthPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p style={{ color: 'crimson' }}>Error: {(error as Error).message}</p>;

  return (
    <section>
      <h2>API health</h2>
      <pre style={{ background: '#f4f4f4', padding: 12 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}
