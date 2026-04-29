import { useState, useCallback, type ReactNode } from 'react';
import { tokens } from '../theme';

export interface LockableProps {
  /** What's being locked (e.g. "Wallet"). Used in the unlock confirmation. */
  label: string;
  /** Render-prop children — receive the current `locked` flag. Disable inputs when locked. */
  children: (state: { locked: boolean; lock: () => void }) => ReactNode;
  /** Optional: re-lock automatically after a successful save. Default: true. */
  relockOnSave?: boolean;
}

/**
 * Wraps a control panel in a "locked by default" gate.
 *
 * - When locked: an overlay shows "🔒 Locked — click to unlock". Children render
 *   below it but interactive elements should consult `locked` and disable themselves.
 * - When unlocked: a "Re-lock" button is shown so the user can intentionally lock
 *   it again after editing.
 *
 * The render-prop signature is intentional — the children opt into the lock state
 * rather than getting stomped by an opaque overlay. Each form chooses how to
 * disable inputs (some prefer fading, some prefer hiding the submit button).
 */
export function Lockable({ label, children, relockOnSave = true }: LockableProps) {
  const [locked, setLocked] = useState(true);
  const lock = useCallback(() => setLocked(true), []);

  return (
    <div style={{ position: 'relative' }}>
      <div style={lockBarStyle(locked)}>
        <span
          aria-hidden
          style={{ fontSize: 14, lineHeight: 1 }}
        >
          {locked ? '🔒' : '🔓'}
        </span>
        <span style={{ fontSize: tokens.fontSize.sm, fontWeight: 500 }}>
          {locked ? `${label} controls are locked` : `${label} controls unlocked`}
        </span>
        <span style={{ flex: 1 }} />
        {locked ? (
          <button
            type="button"
            onClick={() => setLocked(false)}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: `1px solid ${tokens.color.borderStrong}`,
              background: 'white',
              cursor: 'pointer',
              fontSize: tokens.fontSize.sm,
              fontWeight: 500,
            }}
          >
            Unlock to edit
          </button>
        ) : (
          <button
            type="button"
            onClick={lock}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: `1px solid ${tokens.color.borderStrong}`,
              background: 'white',
              cursor: 'pointer',
              fontSize: tokens.fontSize.sm,
            }}
          >
            Re-lock
          </button>
        )}
      </div>
      <div
        style={{
          opacity: locked ? 0.7 : 1,
          pointerEvents: 'auto', // children handle their own disabled state
        }}
      >
        {children({
          locked,
          lock: relockOnSave ? lock : () => {},
        })}
      </div>
    </div>
  );
}

function lockBarStyle(locked: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    marginBottom: tokens.space.md,
    borderRadius: tokens.radius.sm,
    background: locked ? tokens.color.lockedBg : tokens.color.successBg,
    color: locked ? tokens.color.text : tokens.color.success,
    border: `1px solid ${locked ? tokens.color.border : '#a7f3d0'}`,
  };
}
