/**
 * Fenwira color tokens: the single source of truth (docs/design/FENWIRA_DESIGN_SYSTEM.md).
 *
 * Three layers:
 *   1. `palette`         primitive hex values, named by hue and lightness. The ONLY hex in the app.
 *   2. `semanticTokens`  roles (canvas, fg-secondary, status-error-bg, chat-outgoing, …), each a
 *                        light and a dark palette reference. Feature code uses only these.
 *   3. `componentTokens` the few component-specific roles that no semantic role covers (phone
 *                        bezel, template categories, avatar identities, chart series).
 * `tokenAliases` keeps Design System v1 names (`primary-strong`, `text-slate`, …) working while
 * consumers migrate; each alias points at a semantic token, never at a value.
 *
 * `styles/tokens.css` is GENERATED from this file (`renderThemeCss`, pinned by tokens.test.ts):
 * never edit it by hand. Run `pnpm --filter @fenwira/ui test -u` after changing a token.
 */

export const palette = {
  white: '#FFFFFF',
  black: '#000000',
  /** WhatsApp's own brand green: channel identity only. */
  whatsapp: '#25D366',
  /** Fenwira brand emerald (the logo's core green): brand marks and indicators, never text. */
  brand: { emerald: '#00A884', 'emerald-dark': '#10B981' },
  // Graphite: the cool-grey ramp shared by both themes, lightest to darkest. Surfaces carry no
  // green tint (Graphite + Emerald palette, 2026-11-10).
  graphite: {
    0: '#FFFFFF',
    25: '#F6F7F9',
    40: '#F1F3F5',
    50: '#F0F2F5',
    75: '#E9EDF2',
    100: '#E1E5EB',
    120: '#DEE5ED',
    300: '#BCC5D0',
    320: '#B6BFCB',
    380: '#A0ACBC',
    400: '#9AA3AF',
    450: '#8995A5',
    500: '#737F8F',
    540: '#5D6776',
    550: '#657080',
    580: '#596575',
    600: '#586270',
    700: '#35404D',
    720: '#303740',
    750: '#2A3038',
    775: '#252C33',
    780: '#252A30',
    800: '#22272D',
    820: '#20252C',
    850: '#1B1E22',
    900: '#15181C',
    910: '#14191D',
    950: '#111315',
  },
  /** Charcoal link ink. */
  slate: { 300: '#CBD5E1', 700: '#334155' },
  emerald: {
    tint: '#EAF5F0',
    'tint-hover': '#DCEEE5',
    300: '#6EE7B7',
    400: '#34D399',
    500: '#10B981',
    /** Tailwind emerald-600 (#059669) lightened just enough for dark text (AA) on a pressed dark-mode button. */
    'pressed-dark': '#05A271',
    700: '#047857',
    800: '#065F46',
    900: '#064E3B',
    'tint-dark': '#17382D',
    'tint-dark-hover': '#1A3D31',
    975: '#052E24',
  },
  green: {
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    600: '#16A34A',
    800: '#166534',
    900: '#14532D',
    950: '#14281B',
  },
  amber: {
    50: '#FFF7E6',
    100: '#FEF3C7',
    200: '#FDE3B0',
    300: '#FCD34D',
    400: '#FBBF24',
    600: '#D97706',
    700: '#B45309',
    750: '#9A4D0B',
    800: '#92400E',
    900: '#5C4413',
    950: '#2E2410',
  },
  red: {
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#331A1A',
    975: '#450A0A',
  },
  blue: {
    50: '#EFF6FF',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E3A8A',
    950: '#17233A',
  },
  violet: {
    50: '#F5F3FF',
    200: '#DDD6FE',
    300: '#C4B5FD',
    400: '#A78BFA',
    600: '#7C3AED',
    700: '#6D28D9',
    800: '#5B21B6',
    950: '#251C3B',
  },
  /** Rose: contact-label colour only (never an error or status). */
  rose: { 50: '#FFF1F2', 300: '#FDA4AF', 700: '#BE123C', 950: '#351D29' },
  orange: { 50: '#FFF7ED', 300: '#FDBA74', 700: '#C2410C', 950: '#33200F' },
  // Categorical chart hues (validated with the dataviz palette checks: lightness band, chroma,
  // colour-blind separation and >= 3:1 against the chart surface in each mode).
  series: {
    blue: '#2A78D6',
    'blue-dark': '#3987E5',
    orange: '#EB6834',
    'orange-dark': '#D95926',
    violet: '#6250D6',
    'violet-dark': '#9085E9',
    aqua: '#14A06F',
    'aqua-dark': '#199E70',
    'red-dark': '#E66767',
  },
  // Sidebar row states: hover stays visibly lighter than the selected fill in both themes.
  sidebar: {
    hover: '#DEE5ED',
    selected: '#CBD5E1',
    'selected-fg': '#192431',
    'hover-dark': '#262D36',
    'selected-dark': '#354251',
    'selected-fg-dark': '#F4F7FA',
  },
  // Inbox chat surfaces: neutral canvas, soft emerald outgoing bubble, amber private notes.
  chat: {
    outgoing: '#E0EFE7',
    'outgoing-dark': '#1C3B32',
    note: '#FFF6DF',
    'note-fg': '#785014',
    'note-border': '#E7C777',
    'note-dark': '#352B18',
    'note-fg-dark': '#F8DFA0',
    'note-border-dark': '#8A6829',
  },
  // Avatar identity hues: decorative, deterministic per contact, never a status.
  pink: { 100: '#FCE0EC', 200: '#F5B8D0', 800: '#9D2455', 900: '#3A1F2B' },
  lavender: { 100: '#EBDDFB', 200: '#D3BDF5', 800: '#66379B', 900: '#2C2240' },
  peach: { 100: '#FFE1C7', 200: '#F5C29A', 800: '#974613', 900: '#3A2618' },
  mint: { 100: '#CFF3E8', 200: '#8FE3C6', 800: '#065F46', 900: '#163329' },
  periwinkle: { 100: '#DAE7FF', 200: '#A9C4F7', 800: '#274B97', 900: '#1C2840' },
} as const

type Palette = typeof palette
/** `white`, `graphite.600`, `brand.emerald`, … — a reference into `palette`. */
export type PaletteRef = {
  [K in keyof Palette]: Palette[K] extends string
    ? K
    : `${K & string}.${keyof Palette[K] & (string | number)}`
}[keyof Palette]

type ThemePair = { light: PaletteRef; dark: PaletteRef }
const pair = (light: PaletteRef, dark: PaletteRef): ThemePair => ({ light, dark })

/** Semantic roles. Names become `--color-<name>` and Tailwind utilities (`bg-surface-muted`). */
export const semanticTokens = {
  // Surfaces
  canvas: pair('graphite.25', 'graphite.950'),
  sidebar: pair('graphite.50', 'graphite.900'),
  surface: pair('graphite.0', 'graphite.850'),
  'surface-elevated': pair('graphite.0', 'graphite.780'),
  'surface-muted': pair('graphite.50', 'graphite.800'),
  'surface-hover': pair('graphite.75', 'graphite.750'),
  'surface-selected': pair('graphite.120', 'graphite.700'),
  'surface-disabled': pair('graphite.50', 'graphite.800'),
  /** Tooltips and dark chips: the opposite lightness of the page. */
  inverse: pair('graphite.820', 'graphite.40'),
  'inverse-fg': pair('graphite.0', 'graphite.850'),
  'inverse-fg-muted': pair('graphite.300', 'graphite.600'),
  'inverse-border': pair('graphite.600', 'graphite.300'),
  'inverse-hover': pair('graphite.750', 'graphite.120'),
  /** Dialog backdrop; applied through the `bg-scrim-overlay` utility (45% light, 65% dark). */
  scrim: pair('graphite.950', 'black'),
  /** Shadow color; consumed by the elevation tokens in theme.css. */
  shadow: pair('graphite.950', 'black'),

  // Text and icons
  fg: pair('graphite.820', 'graphite.40'),
  'fg-secondary': pair('graphite.600', 'graphite.320'),
  /** Light is #657080 darkened to #5D6776: the approved value is < 4.5:1 on sidebar/hover/selected. */
  'fg-muted': pair('graphite.540', 'graphite.380'),
  /** Disabled text pairs with opacity/disabled semantics; exempt from AA (WCAG 1.4.3). */
  'fg-disabled': pair('graphite.400', 'graphite.550'),
  /** Idle icons, dots, connectors: non-text, 3:1 on canvas, sidebar and surfaces. */
  'fg-subtle': pair('graphite.500', 'graphite.450'),

  // Borders and focus
  /** Decorative separators only. */
  'border-subtle': pair('graphite.100', 'graphite.720'),
  /** Text-field and secondary-button outline. Labelled controls (WCAG 1.4.11 exception). */
  'border-control': pair('graphite.300', 'graphite.580'),
  /** Checkbox, radio and switch boundaries, which need 3:1 on their own. */
  'border-control-strong': pair('graphite.500', 'graphite.450'),
  'focus-ring': pair('emerald.700', 'emerald.500'),

  // Primary action (emerald): primary buttons, focus, checked controls and selection markers.
  'action-primary': pair('emerald.700', 'emerald.500'),
  'action-primary-hover': pair('emerald.800', 'emerald.400'),
  'action-primary-pressed': pair('emerald.900', 'emerald.pressed-dark'),
  'action-primary-fg': pair('white', 'emerald.975'),
  'action-primary-subtle': pair('emerald.tint', 'emerald.tint-dark'),
  'action-primary-subtle-hover': pair('emerald.tint-hover', 'emerald.tint-dark-hover'),
  /** Emerald text and icons on `action-primary-subtle`. */
  'action-primary-subtle-fg': pair('emerald.800', 'emerald.300'),
  'action-danger': pair('red.700', 'red.400'),
  'action-danger-hover': pair('red.800', 'red.300'),
  'action-danger-fg': pair('white', 'red.975'),
  /** Ordinary links: charcoal, underlined (lib/link.ts). Emerald is for actions only. */
  link: pair('slate.700', 'slate.300'),
  'link-hover': pair('graphite.820', 'graphite.40'),
  /** Brand emerald: approved logo treatments and small identity accents. Never text or an action. */
  brand: pair('brand.emerald', 'brand.emerald-dark'),
  /** WhatsApp channel identity. Not an action or status color. */
  whatsapp: pair('whatsapp', 'whatsapp'),

  // Feature accents
  'accent-conversation': pair('blue.600', 'blue.400'),
  'accent-conversation-fg': pair('blue.700', 'blue.300'),
  'accent-conversation-bg': pair('blue.50', 'blue.950'),
  'accent-conversation-border': pair('blue.200', 'blue.800'),
  'accent-automation': pair('violet.600', 'violet.400'),
  'accent-automation-fg': pair('violet.700', 'violet.300'),
  'accent-automation-bg': pair('violet.50', 'violet.950'),
  'accent-automation-border': pair('violet.200', 'violet.800'),

  // Status: solid (dots, bars, icons beside a label) · fg (text) · bg (tint) · border
  'status-success': pair('green.600', 'green.400'),
  'status-success-fg': pair('green.800', 'green.300'),
  'status-success-bg': pair('green.100', 'green.950'),
  'status-success-border': pair('green.200', 'green.900'),
  'status-warning': pair('amber.600', 'amber.400'),
  'status-warning-fg': pair('amber.750', 'amber.300'),
  'status-warning-bg': pair('amber.100', 'amber.950'),
  'status-warning-border': pair('amber.200', 'amber.900'),
  'status-error': pair('red.600', 'red.400'),
  'status-error-fg': pair('red.700', 'red.300'),
  'status-error-bg': pair('red.100', 'red.950'),
  'status-error-border': pair('red.200', 'red.900'),
  'status-info': pair('blue.600', 'blue.400'),
  'status-info-fg': pair('blue.700', 'blue.300'),
  'status-info-bg': pair('blue.50', 'blue.950'),
  'status-info-border': pair('blue.200', 'blue.800'),
  'status-neutral': pair('graphite.500', 'graphite.450'),
  'status-neutral-fg': pair('graphite.600', 'graphite.320'),
  'status-neutral-bg': pair('graphite.50', 'graphite.750'),
  'status-neutral-border': pair('graphite.100', 'graphite.580'),

  // Chat (WhatsApp-inspired thread inside a neutral inbox shell)
  'chat-canvas': pair('graphite.40', 'graphite.910'),
  'chat-pattern': pair('graphite.500', 'graphite.450'),
  'chat-incoming': pair('graphite.0', 'graphite.775'),
  'chat-incoming-fg': pair('graphite.820', 'graphite.40'),
  'chat-incoming-border': pair('graphite.100', 'graphite.720'),
  'chat-outgoing': pair('chat.outgoing', 'chat.outgoing-dark'),
  'chat-outgoing-fg': pair('graphite.820', 'graphite.40'),
  /** Timestamps, sender labels and sent/delivered ticks on either bubble. */
  'chat-meta': pair('graphite.600', 'graphite.320'),
  'chat-read': pair('blue.600', 'blue.400'),
  'chat-note': pair('chat.note', 'chat.note-dark'),
  'chat-note-border': pair('chat.note-border', 'chat.note-border-dark'),
  'chat-note-fg': pair('chat.note-fg', 'chat.note-fg-dark'),
} as const satisfies Record<string, ThemePair>

/** Component tokens: only where no semantic role fits. */
export const componentTokens = {
  'phone-bezel': pair('graphite.820', 'graphite.580'),
  // Sidebar rows (collapsed icons, expanded rows, submenu links, bottom utilities): grey hover,
  // a stronger grey selected fill and a thin emerald indicator on the leading edge.
  'sidebar-item-hover': pair('sidebar.hover', 'sidebar.hover-dark'),
  'sidebar-item-hover-fg': pair('graphite.820', 'graphite.40'),
  'sidebar-item-selected': pair('sidebar.selected', 'sidebar.selected-dark'),
  /** Selected keeps its fill on hover, so selection never reads as a hover state. */
  'sidebar-item-selected-hover': pair('sidebar.selected', 'sidebar.selected-dark'),
  'sidebar-item-selected-fg': pair('sidebar.selected-fg', 'sidebar.selected-fg-dark'),
  'sidebar-item-selected-indicator': pair('emerald.700', 'emerald.500'),
  /**
   * Hover on selectable list and table rows: midway between the row surface and
   * `surface-selected` in each theme, so hover never reads as selection (or as nothing).
   */
  'list-item-hover': pair('graphite.50', 'graphite.750'),
  // Template categories (Utility reuses status-info).
  'category-marketing-fg': pair('violet.700', 'violet.300'),
  'category-marketing-bg': pair('violet.50', 'violet.950'),
  'category-authentication-fg': pair('orange.700', 'orange.300'),
  'category-authentication-bg': pair('orange.50', 'orange.950'),
  // Contact labels (user-chosen tag colours): decorative identity, never a status or an action.
  'label-blue-bg': pair('blue.50', 'blue.950'),
  'label-blue-fg': pair('blue.700', 'blue.300'),
  /** Muted green label: the same accessible green pair as status-success, under a label name. */
  'label-green-bg': pair('green.100', 'green.950'),
  'label-green-fg': pair('green.800', 'green.300'),
  'label-amber-bg': pair('amber.100', 'amber.950'),
  'label-amber-fg': pair('amber.800', 'amber.300'),
  'label-rose-bg': pair('rose.50', 'rose.950'),
  'label-rose-fg': pair('rose.700', 'rose.300'),
  'label-teal-bg': pair('mint.100', 'mint.900'),
  'label-teal-fg': pair('mint.800', 'mint.200'),
  'label-neutral-bg': pair('graphite.50', 'graphite.750'),
  'label-neutral-fg': pair('graphite.600', 'graphite.320'),
  // Avatar identities (data-driven, decorative).
  'avatar-pink-bg': pair('pink.100', 'pink.900'),
  'avatar-pink-fg': pair('pink.800', 'pink.200'),
  'avatar-lavender-bg': pair('lavender.100', 'lavender.900'),
  'avatar-lavender-fg': pair('lavender.800', 'lavender.200'),
  'avatar-peach-bg': pair('peach.100', 'peach.900'),
  'avatar-peach-fg': pair('peach.800', 'peach.200'),
  'avatar-mint-bg': pair('mint.100', 'mint.900'),
  'avatar-mint-fg': pair('mint.800', 'mint.200'),
  'avatar-periwinkle-bg': pair('periwinkle.100', 'periwinkle.900'),
  'avatar-periwinkle-fg': pair('periwinkle.800', 'periwinkle.200'),
  // Chart series (TrendChart): 3:1 against the surface in both themes. chart-1…6 are the original
  // tones (still used by the operator console); the named series below are the validated set.
  'chart-1': pair('emerald.700', 'emerald.500'),
  'chart-2': pair('blue.600', 'blue.400'),
  'chart-3': pair('green.800', 'green.400'),
  'chart-4': pair('red.600', 'red.400'),
  'chart-5': pair('amber.700', 'amber.400'),
  'chart-6': pair('graphite.600', 'graphite.380'),
  // Message funnel (sent → delivered → read): one ordinal blue ramp, light to dark.
  'chart-stage-1': pair('blue.500', 'blue.600'),
  'chart-stage-2': pair('blue.700', 'blue.400'),
  'chart-stage-3': pair('blue.800', 'blue.200'),
  // Nominal categories, in this fixed order (never cycled).
  'chart-blue': pair('series.blue', 'series.blue-dark'),
  'chart-orange': pair('series.orange', 'series.orange-dark'),
  'chart-violet': pair('series.violet', 'series.violet-dark'),
  'chart-aqua': pair('series.aqua', 'series.aqua-dark'),
  // Outcomes that are statuses (always with a legend label) and the grey "other".
  'chart-good': pair('green.600', 'green.600'),
  'chart-critical': pair('red.600', 'series.red-dark'),
  'chart-other': pair('graphite.500', 'graphite.450'),
} as const satisfies Record<string, ThemePair>

export type SemanticToken = keyof typeof semanticTokens | keyof typeof componentTokens

/**
 * @deprecated Design System v1 names, kept so existing classes (`bg-primary-strong`,
 * `text-slate`, …) keep working. Each resolves to a semantic token in both themes. New code uses
 * the semantic names; remove an alias once nothing references it.
 */
export const tokenAliases = {
  primary: 'action-primary',
  'primary-hover': 'action-primary-hover',
  'primary-soft': 'action-primary-subtle',
  'primary-strong': 'action-primary',
  'primary-strong-hover': 'action-primary-hover',
  success: 'status-success',
  'success-soft': 'status-success-bg',
  'success-strong': 'status-success-fg',
  warning: 'status-warning',
  'warning-soft': 'status-warning-bg',
  'warning-strong': 'status-warning-fg',
  danger: 'status-error',
  'danger-soft': 'status-error-bg',
  'danger-strong': 'status-error-fg',
  'danger-strong-hover': 'action-danger-hover',
  info: 'status-info',
  'info-soft': 'status-info-bg',
  'info-strong': 'status-info-fg',
  slate: 'fg',
  'slate-800': 'fg',
  'slate-400': 'fg-subtle',
  secondary: 'fg-secondary',
  muted: 'fg-muted',
  background: 'canvas',
  border: 'border-subtle',
  'border-strong': 'border-control',
  'sidebar-border': 'border-subtle',
  'neutral-soft': 'surface-muted',
} as const satisfies Record<string, SemanticToken>

export type ColorToken = SemanticToken | keyof typeof tokenAliases
export type ThemeName = 'light' | 'dark'

export const resolvePaletteRef = (ref: PaletteRef): string => {
  const [group, step] = ref.split('.') as [keyof Palette, string | undefined]
  const value =
    step === undefined ? palette[group] : (palette[group] as Record<string, string>)[step]
  if (typeof value !== 'string') throw new Error(`Unknown palette reference: ${ref}`)
  return value
}

const allRoles = { ...semanticTokens, ...componentTokens }

/** Every semantic, component and alias token resolved to hex for one theme. */
export function resolveTheme(theme: ThemeName): Record<ColorToken, string> {
  const out = {} as Record<ColorToken, string>
  for (const [name, refs] of Object.entries(allRoles))
    out[name as SemanticToken] = resolvePaletteRef(refs[theme])
  for (const [alias, target] of Object.entries(tokenAliases))
    out[alias as keyof typeof tokenAliases] = out[target]
  return out
}

export const themes = { light: resolveTheme('light'), dark: resolveTheme('dark') } as const

/**
 * Resolved light values (the default theme) for places that need a literal color outside CSS:
 * the web manifest and the browser `theme-color`.
 */
export const colorTokens = themes.light

/** `--color-<token>` custom property name for a token. */
export const cssVar = (token: ColorToken): `--color-${ColorToken}` => `--color-${token}`
