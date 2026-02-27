export default function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = confidence * 100;
  const barColor = confidence >= 0.7
    ? 'bg-emerald-500'
    : confidence >= 0.4
      ? 'bg-amber-500'
      : 'bg-gray-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-mono w-12 text-right text-gray-400">
        {confidence.toFixed(2)}
      </span>
    </div>
  );
}
