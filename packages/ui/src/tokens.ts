/**
 * Fenwira color tokens: the contract in docs/design/FENWIRA_DESIGN_SYSTEM.md (Design System v1).
 * This file and styles/theme.css are the ONLY places hex values may appear. Feature code uses
 * semantic Tailwind classes (`bg-primary-strong`, `text-secondary`, `border-border`), never these.
 */
export const colorTokens = {
  // Fenwira brand / action (non-text: indicators, focus, selection). Text and filled buttons use -strong.
  primary: '#00A884',
  'primary-hover': '#008F70',
  'primary-soft': '#EAF7F2',
  'primary-strong': '#007F64',
  'primary-strong-hover': '#006B54',
  // WhatsApp context (channel identity: WhatsApp previews, the "on WhatsApp" mark). Not an action color.
  whatsapp: '#25D366',
  // Status: success (active, connected, approved, delivered, healthy)
  success: '#16A34A',
  'success-soft': '#D1FAE5',
  'success-strong': '#166534',
  // Status: warning (paused, attention required, low balance)
  warning: '#F59E0B',
  'warning-soft': '#FEF3C7',
  'warning-strong': '#B45309',
  // Status: danger (failed, rejected, disconnected, destructive)
  danger: '#DC2626',
  'danger-soft': '#FEE2E2',
  'danger-strong': '#B91C1C',
  'danger-strong-hover': '#991B1B',
  // Status: info (scheduled, processing, syncing; human takeover)
  info: '#2563EB',
  'info-soft': '#EFF6FF',
  'info-strong': '#1D4ED8',
  // Text and chrome
  slate: '#18201D',
  'slate-800': '#1E293B',
  'slate-400': '#94A3B8',
  secondary: '#4B5550',
  muted: '#66716B',
  // Surfaces
  background: '#F7F7F4',
  surface: '#FFFFFF',
  sidebar: '#FAFAF8',
  'sidebar-border': '#E7E7E2',
  'muted-decorative': '#737C77',
  border: '#E5E7E3',
  'border-strong': '#D6D9D4',
  'neutral-soft': '#F5F5F1',
} as const

export type ColorToken = keyof typeof colorTokens

/** `--color-<token>` custom property name for a token. */
export const cssVar = (token: ColorToken): `--color-${ColorToken}` => `--color-${token}`
