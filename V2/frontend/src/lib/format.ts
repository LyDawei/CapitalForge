export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(digits)}%`;

export const ms = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Math.round(n)}ms`;

export const usd = (n: number | null | undefined, digits = 4) =>
  n === null || n === undefined ? '—' : `$${n.toFixed(digits)}`;

export const num = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? '—' : n.toFixed(digits);

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
};
