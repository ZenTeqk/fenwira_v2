/**
 * Fenwira color tokens — the contract in docs/DESIGN_SYSTEM.md. This package is the ONLY place
 * hex values may appear. Phase 2 exposes these as CSS variables / Tailwind theme and builds
 * components on top; feature code uses semantic classes, never these literals.
 */
export const colorTokens = {
  primary: '#00A884',
  'primary-hover': '#008F70',
  'primary-soft': '#E7FCE8',
  success: '#25D366',
  'success-soft': '#D1FAE5',
  warning: '#F59E0B',
  danger: '#EF4444',
  'danger-soft': '#FEE2E2',
  info: '#6366F1',
  slate: '#0F172A',
  'slate-800': '#1E293B',
  'slate-400': '#94A3B8',
  muted: '#64748B',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  'neutral-soft': '#F1F5F9',
  // WCAG AA shades for filled buttons and colored text (docs/DESIGN_SYSTEM.md, decided 2026-09-23)
  'primary-strong': '#007F64',
  'primary-strong-hover': '#006B54',
  'danger-strong': '#C81E1E',
  'danger-strong-hover': '#A51919',
  'info-strong': '#4F46E5',
} as const

export type ColorToken = keyof typeof colorTokens

/** `--color-<token>` custom property name for a token. */
export const cssVar = (token: ColorToken): `--color-${ColorToken}` => `--color-${token}`
