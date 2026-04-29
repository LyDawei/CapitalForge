interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke color. Defaults to slate-700. */
  stroke?: string;
  /** Optional fill under the line for an area chart look. */
  fill?: string;
}

/**
 * Tiny inline-SVG sparkline. No dependency on a charting library — these are
 * meant to be many-on-screen at low cost. Falls back to a flat dash when the
 * series is empty or constant.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = '#1f2937',
  fill,
}: SparklineProps) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="#cbd5e1" strokeDasharray="2 3" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastY = height - ((values[values.length - 1] - min) / range) * (height - 2) - 1;
  const direction = values[values.length - 1] - values[0];
  const accent = direction >= 0 ? '#065f46' : '#991b1b';
  return (
    <svg width={width} height={height} role="img" aria-label="recent close prices">
      {fill && (
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={fill}
          opacity={0.25}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={width} cy={lastY} r={2.5} fill={accent} />
    </svg>
  );
}
