interface Props {
  from: string;
  to: string;
}

/**
 * Trivial line-by-line diff — good enough for prompt iteration audits without a
 * diff library. Lines unique to `from` are red, unique to `to` are green.
 */
export default function PromptDiff({ from, to }: Props) {
  const fromLines = from.split('\n');
  const toLines = to.split('\n');
  const fromSet = new Set(fromLines);
  const toSet = new Set(toLines);

  return (
    <div className="grid cols-2">
      <pre className="prompt">
        {fromLines.map((line, i) => (
          <div key={`f-${i}`} style={{ background: toSet.has(line) ? 'transparent' : 'rgba(239,107,115,0.15)' }}>
            {line || ' '}
          </div>
        ))}
      </pre>
      <pre className="prompt">
        {toLines.map((line, i) => (
          <div key={`t-${i}`} style={{ background: fromSet.has(line) ? 'transparent' : 'rgba(127,200,169,0.15)' }}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
