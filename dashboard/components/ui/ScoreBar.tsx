export default function ScoreBar({ score }: { score: number }) {
  // score is -1 to +1. Map to 0-100% position.
  const pct = ((score + 1) / 2) * 100;
  const barColor = score > 0.2
    ? 'bg-emerald-500'
    : score < -0.2
      ? 'bg-red-500'
      : 'bg-amber-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
        {/* Score indicator */}
        <div
          className={`absolute top-0 h-full ${barColor} rounded-full`}
          style={{
            left: score >= 0 ? '50%' : `${pct}%`,
            width: `${Math.abs(score) * 50}%`,
          }}
        />
      </div>
      <span className={`text-sm font-mono w-14 text-right ${
        score > 0.2 ? 'text-emerald-400' : score < -0.2 ? 'text-red-400' : 'text-amber-400'
      }`}>
        {score >= 0 ? '+' : ''}{score.toFixed(2)}
      </span>
    </div>
  );
}
