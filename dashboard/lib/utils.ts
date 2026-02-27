export function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatScore(value: number): string {
  return value.toFixed(3);
}

export function formatVolume(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function agentDisplayName(name: string): string {
  const names: Record<string, string> = {
    momentum: 'Momentum',
    meanReversion: 'Mean Reversion',
    confirmation: 'Confirmation',
    newsEvents: 'News & Events',
  };
  return names[name] || name;
}

export function decisionColor(decision: string): string {
  switch (decision) {
    case 'BUY': return 'text-emerald-400';
    case 'SELL': return 'text-red-400';
    default: return 'text-gray-400';
  }
}

export function decisionBgColor(decision: string): string {
  switch (decision) {
    case 'BUY': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'SELL': return 'bg-red-500/20 text-red-400 border-red-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

export function statusBgColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'filled': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    default: return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  }
}

export function scoreColor(score: number): string {
  if (score > 0.4) return 'text-emerald-400';
  if (score < -0.4) return 'text-red-400';
  if (score > 0.1) return 'text-emerald-300';
  if (score < -0.1) return 'text-red-300';
  return 'text-gray-400';
}
