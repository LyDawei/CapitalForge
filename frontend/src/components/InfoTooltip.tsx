interface Props {
  text: string;
  align?: 'left' | 'center' | 'right';
}

// Plain-language explanation for a metric/label. Hover or focus reveals the
// bubble — this app's audience isn't assumed to have finance/trading
// background, so anything not self-evident (a percentage, a stdev, a term
// borrowed from trading jargon) should carry one of these rather than assume
// familiarity.
export default function InfoTooltip({ text, align = 'center' }: Props) {
  return (
    <span className={`info-tip align-${align}`} tabIndex={0}>
      <span className="info-tip-icon" aria-hidden="true">i</span>
      <span className="info-tip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
