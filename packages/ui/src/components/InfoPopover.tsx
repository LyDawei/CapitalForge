import { useEffect, useRef, useState } from 'react';

export interface InfoPopoverProps {
  /** Short one-liner shown when collapsed. */
  short?: string;
  /** Detailed explanation, can include line breaks. */
  detailed: string;
  /** Worked example text. Shown after the detailed explanation. */
  example?: string;
  /** Optional label override for the trigger button. Default: "i". */
  triggerLabel?: string;
}

/**
 * Floating expandable explanation. The popover opens absolutely-positioned so it
 * doesn't push surrounding content around. Auto-closes on outside click or Esc.
 *
 * The popover is rendered ABSOLUTELY relative to the trigger wrapper, with a
 * left/right alignment chosen at open time based on viewport space — this keeps
 * tooltips on right-edge cards from clipping off-screen without a portal.
 */
export function InfoPopover({ short, detailed, example, triggerLabel }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 300;
      const wouldOverflow = rect.left + popoverWidth > window.innerWidth - 16;
      setAlignRight(wouldOverflow);
    }
    setOpen((v) => !v);
  };

  return (
    <span
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={short ?? 'More info'}
        title={short}
        style={{
          appearance: 'none',
          border: '1px solid #d1d5db',
          background: open ? '#1f2937' : 'white',
          color: open ? 'white' : '#374151',
          width: 18,
          height: 18,
          borderRadius: 9,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
        }}
      >
        {triggerLabel ?? 'i'}
      </button>
      {open && (
        <div
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            ...(alignRight ? { right: 0 } : { left: 0 }),
            marginTop: 6,
            zIndex: 1000,
            background: '#0f172a',
            color: '#e5e7eb',
            padding: '10px 12px',
            borderRadius: 6,
            width: 'min(300px, 90vw)',
            fontSize: 12,
            lineHeight: 1.5,
            boxShadow: '0 8px 24px rgba(15,23,42,0.25)',
            whiteSpace: 'normal',
            textAlign: 'left',
            // Decoupled from parent typography
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 'normal',
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>{detailed}</div>
          {example && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px dashed #475569',
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                fontSize: 11,
                color: '#cbd5e1',
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong style={{ color: '#fbbf24' }}>Example:</strong> {example}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/**
 * Inline collapsible primer block. Used at the top of a section to explain
 * jargon (R-multiple, drawdown, conviction) before showing the form.
 */
export function PrimerBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details
      style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1e3a8a' }}>{title}</summary>
      <div style={{ marginTop: 8, color: '#1e40af' }}>{children}</div>
    </details>
  );
}
