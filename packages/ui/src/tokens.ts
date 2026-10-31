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
  // Warm-neutral ramp shared by both themes, lightest to darkest. No hue tint on surfaces.
  neutral: {
    0: '#FFFFFF',
    25: '#F5F5F4',
    50: '#F0F0ED',
    60: '#EFEFED',
    70: '#ECECE9',
    75: '#EAEAE7',
    100: '#E7E7E4',
    150: '#DEDED8',
    200: '#CFCFC8',
    300: '#B3B5AD',
    330: '#A8AAA2',
    400: '#80837B',
    450: '#7A7D75',
    600: '#62665E',
    700: '#4A4C46',
    750: '#3B3B37',
    800: '#2E2F2C',
    825: '#2A2B28',
    850: '#272826',
    900: '#242622',
    910: '#232422',
    925: '#1D1E1C',
    950: '#171816',
    960: '#151614',
    975: '#121311',
  },
  emerald: {
    50: '#ECFDF5',
    100: '#D1FAE5',
    300: '#6EE7B7',
    400: '#34D399',
    700: '#047857',
    800: '#065F46',
    850: '#1A3D2E',
    900: '#143024',
    975: '#022C22',
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
    975: '#2B0A0A',
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
  // WhatsApp-inspired chat surfaces (warm paper canvas, leaf outgoing, forest outgoing in dark).
  chat: { sand: '#F3F0EA', leaf: '#DDEED5', forest: '#1E3A2B' },
  // Avatar identity hues: decorative, deterministic per contact, never a status.
  pink: { 100: '#FCE0EC', 200: '#F5B8D0', 800: '#9D2455', 900: '#3A1F2B' },
  lavender: { 100: '#EBDDFB', 200: '#D3BDF5', 800: '#66379B', 900: '#2C2240' },
  peach: { 100: '#FFE1C7', 200: '#F5C29A', 800: '#974613', 900: '#3A2618' },
  mint: { 100: '#CFF3E8', 200: '#8FE3C6', 800: '#065F46', 900: '#163329' },
  periwinkle: { 100: '#DAE7FF', 200: '#A9C4F7', 800: '#274B97', 900: '#1C2840' },
} as const

type Palette = typeof palette
/** `white`, `neutral.600`, `brand.emerald`, … — a reference into `palette`. */
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
  canvas: pair('neutral.25', 'neutral.975'),
  sidebar: pair('neutral.60', 'neutral.950'),
  surface: pair('neutral.0', 'neutral.925'),
  'surface-elevated': pair('neutral.0', 'neutral.850'),
  'surface-muted': pair('neutral.50', 'neutral.910'),
  'surface-hover': pair('neutral.75', 'neutral.800'),
  'surface-selected': pair('neutral.100', 'neutral.750'),
  'surface-disabled': pair('neutral.50', 'neutral.910'),
  /** Tooltips and dark chips: the opposite lightness of the page. */
  inverse: pair('neutral.900', 'neutral.70'),
  'inverse-fg': pair('neutral.0', 'neutral.925'),
  'inverse-fg-muted': pair('neutral.300', 'neutral.600'),
  'inverse-border': pair('neutral.700', 'neutral.200'),
  'inverse-hover': pair('neutral.800', 'neutral.100'),
  /** Dialog backdrop; used with an opacity modifier (`bg-scrim/50`). */
  scrim: pair('neutral.900', 'black'),
  /** Shadow color; consumed by the elevation tokens in theme.css. */
  shadow: pair('neutral.975', 'black'),

  // Text and icons
  fg: pair('neutral.900', 'neutral.70'),
  'fg-secondary': pair('neutral.600', 'neutral.300'),
  /** Same light value as secondary: nothing lighter clears AA on the selected surface. */
  'fg-muted': pair('neutral.600', 'neutral.330'),
  /** Disabled text pairs with opacity/disabled semantics; exempt from AA (WCAG 1.4.3). */
  'fg-disabled': pair('neutral.300', 'neutral.700'),
  /** Idle icons, dots, connectors: non-text, 3:1 on canvas, sidebar and surfaces. */
  'fg-subtle': pair('neutral.400', 'neutral.450'),

  // Borders and focus
  'border-subtle': pair('neutral.150', 'neutral.800'),
  /** Text-field and secondary-button outline. Labelled controls (WCAG 1.4.11 exception). */
  'border-control': pair('neutral.200', 'neutral.700'),
  /** Checkbox, radio and switch boundaries, which need 3:1 on their own. */
  'border-control-strong': pair('neutral.400', 'neutral.450'),
  'focus-ring': pair('emerald.700', 'emerald.400'),

  // Primary action (emerald). Also green links/text and selection indicators.
  'action-primary': pair('emerald.700', 'emerald.400'),
  'action-primary-hover': pair('emerald.800', 'emerald.300'),
  'action-primary-fg': pair('white', 'emerald.975'),
  'action-primary-subtle': pair('emerald.50', 'emerald.900'),
  'action-primary-subtle-hover': pair('emerald.100', 'emerald.850'),
  'action-danger': pair('red.700', 'red.400'),
  'action-danger-hover': pair('red.800', 'red.300'),
  'action-danger-fg': pair('white', 'red.975'),
  /** Brand emerald: brand marks and the active-navigation bar. Never text, never an action. */
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
  'status-neutral': pair('neutral.400', 'neutral.450'),
  'status-neutral-fg': pair('neutral.600', 'neutral.300'),
  'status-neutral-bg': pair('neutral.50', 'neutral.800'),
  'status-neutral-border': pair('neutral.150', 'neutral.700'),

  // Chat (WhatsApp-inspired thread inside a neutral inbox shell)
  'chat-canvas': pair('chat.sand', 'neutral.960'),
  'chat-pattern': pair('neutral.400', 'neutral.450'),
  'chat-incoming': pair('neutral.0', 'neutral.825'),
  'chat-incoming-border': pair('neutral.150', 'neutral.750'),
  'chat-outgoing': pair('chat.leaf', 'chat.forest'),
  /** Timestamps, sender labels and sent/delivered ticks on either bubble. */
  'chat-meta': pair('neutral.600', 'neutral.300'),
  'chat-read': pair('blue.600', 'blue.400'),
  'chat-note': pair('amber.50', 'amber.950'),
  'chat-note-border': pair('amber.200', 'amber.900'),
  'chat-note-fg': pair('amber.800', 'amber.300'),
} as const satisfies Record<string, ThemePair>

/** Component tokens: only where no semantic role fits. */
export const componentTokens = {
  'phone-bezel': pair('neutral.900', 'neutral.700'),
  // Template categories (Utility reuses status-info).
  'category-marketing-fg': pair('violet.700', 'violet.300'),
  'category-marketing-bg': pair('violet.50', 'violet.950'),
  'category-authentication-fg': pair('orange.700', 'orange.300'),
  'category-authentication-bg': pair('orange.50', 'orange.950'),
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
  'chart-1': pair('emerald.700', 'emerald.400'),
  'chart-2': pair('blue.600', 'blue.400'),
  'chart-3': pair('green.800', 'green.400'),
  'chart-4': pair('red.600', 'red.400'),
  'chart-5': pair('amber.700', 'amber.400'),
  'chart-6': pair('neutral.600', 'neutral.330'),
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
  'chart-other': pair('neutral.400', 'neutral.450'),
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
