// Design tokens — single source of truth for colors / spacing / typography.
// Keeping the palette tight: neutral grays + a single accent (slate-900 / blue-600 hint).

export const tokens = {
  color: {
    bg: '#f5f6f8',
    surface: '#ffffff',
    surfaceMuted: '#f9fafb',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',
    text: '#111827',
    textMuted: '#6b7280',
    textSubtle: '#9ca3af',
    accent: '#1f2937',
    accentText: '#ffffff',
    success: '#065f46',
    successBg: '#d1fae5',
    danger: '#991b1b',
    dangerBg: '#fee2e2',
    warning: '#92400e',
    warningBg: '#fef3c7',
    info: '#1e3a8a',
    infoBg: '#dbeafe',
    locked: '#9ca3af',
    lockedBg: '#f3f4f6',
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
  },
  shadow: {
    card: '0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)',
    elevated: '0 4px 12px rgba(15,23,42,0.06), 0 2px 4px rgba(15,23,42,0.04)',
  },
  font: {
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  fontSize: {
    xs: 11,
    sm: 12,
    base: 13,
    md: 14,
    lg: 16,
    xl: 20,
    h1: 22,
    h2: 18,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
};

export const sectionStyle: React.CSSProperties = {
  background: tokens.color.surface,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.lg,
  padding: tokens.space.lg,
  boxShadow: tokens.shadow.card,
};

export const cardStyle: React.CSSProperties = {
  background: tokens.color.surfaceMuted,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.md,
  padding: tokens.space.md,
};

export const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: tokens.space.md,
  marginBottom: tokens.space.md,
};

export const buttonPrimary: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: tokens.radius.sm,
  border: '1px solid transparent',
  background: tokens.color.accent,
  color: tokens.color.accentText,
  cursor: 'pointer',
  fontSize: tokens.fontSize.base,
  fontWeight: 500,
};

export const buttonSecondary: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.color.borderStrong}`,
  background: tokens.color.surface,
  color: tokens.color.text,
  cursor: 'pointer',
  fontSize: tokens.fontSize.base,
};

export const buttonGhost: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: tokens.radius.sm,
  border: '1px solid transparent',
  background: 'transparent',
  color: tokens.color.text,
  cursor: 'pointer',
  fontSize: tokens.fontSize.base,
};

import type * as React from 'react';
