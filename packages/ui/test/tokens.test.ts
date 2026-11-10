import { describe, expect, it } from 'vitest'
import {
  type ColorToken,
  colorTokens,
  componentTokens,
  cssVar,
  palette,
  resolvePaletteRef,
  semanticTokens,
  type ThemeName,
  themes,
  tokenAliases,
} from '../src'
import { renderThemeCss } from '../src/theme-css'

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

type Pair = [fg: ColorToken, bg: ColorToken]
const cross = (fgs: ColorToken[], bgs: ColorToken[]): Pair[] =>
  fgs.flatMap((fg) => bgs.map((bg): Pair => [fg, bg]))

const STATUSES = ['success', 'warning', 'error', 'info', 'neutral'] as const
const ACCENTS = ['conversation', 'automation'] as const
const AVATARS = ['pink', 'lavender', 'peach', 'mint', 'periwinkle'] as const
const LABELS = ['blue', 'green', 'amber', 'rose', 'teal', 'neutral'] as const

/** Every surface body text can sit on. */
const TEXT_SURFACES: ColorToken[] = [
  'canvas',
  'sidebar',
  'surface',
  'surface-elevated',
  'surface-muted',
  'surface-hover',
  'surface-selected',
  'action-primary-subtle',
  'action-primary-subtle-hover',
  'chat-canvas',
  'chat-incoming',
  'chat-outgoing',
  'chat-note',
  ...STATUSES.map((s): ColorToken => `status-${s}-bg`),
  ...ACCENTS.map((a): ColorToken => `accent-${a}-bg`),
]

/** Text pairs that must clear WCAG AA 4.5:1 (1.4.3) in both themes. */
const TEXT_PAIRS: Pair[] = [
  // Sidebar rows: idle labels on the sidebar, hover and selected (incl. selected + hover).
  ['fg-secondary', 'sidebar'],
  ['sidebar-item-hover-fg', 'sidebar-item-hover'],
  ['sidebar-item-selected-fg', 'sidebar-item-selected'],
  ['sidebar-item-selected-fg', 'sidebar-item-selected-hover'],
  ...cross(['fg', 'fg-secondary', 'fg-muted'], [...TEXT_SURFACES, 'list-item-hover']),
  // Charcoal links (idle and hover) on every surface they sit on.
  ...cross(
    ['link', 'link-hover'],
    [
      'canvas',
      'sidebar',
      'surface',
      'surface-elevated',
      'surface-muted',
      'surface-hover',
      'surface-selected',
    ],
  ),
  // Emerald text on its subtle tint.
  ...cross(['action-primary-subtle-fg'], ['action-primary-subtle', 'action-primary-subtle-hover']),
  // Bubble text.
  ['chat-incoming-fg', 'chat-incoming'],
  ['chat-outgoing-fg', 'chat-outgoing'],
  // Emerald text (never on the neutral selected surface).
  ...cross(
    ['action-primary'],
    [
      'canvas',
      'sidebar',
      'surface',
      'surface-elevated',
      'surface-muted',
      'surface-hover',
      'action-primary-subtle',
      'action-primary-subtle-hover',
      'chat-incoming',
    ],
  ),
  ...cross(['action-primary-hover'], ['surface', 'action-primary-subtle-hover']),
  // Text on filled buttons, including the legacy `text-surface` on a filled alias.
  ...cross(
    ['action-primary-fg', 'surface'],
    ['action-primary', 'action-primary-hover', 'action-primary-pressed'],
  ),
  ...cross(['action-danger-fg'], ['action-danger', 'action-danger-hover']),
  ['surface', 'status-error-fg'],
  ...cross(['inverse-fg', 'inverse-fg-muted'], ['inverse', 'inverse-hover']),
  ['surface', 'inverse'],
  // Status and accent text on their tint and on the surfaces they appear on.
  ...STATUSES.flatMap((s) =>
    cross([`status-${s}-fg`], [`status-${s}-bg`, 'surface', 'canvas', 'sidebar', 'surface-muted']),
  ),
  ...ACCENTS.flatMap((a) => cross([`accent-${a}-fg`], [`accent-${a}-bg`, 'surface', 'canvas'])),
  // Chat: metadata on every bubble and the canvas; links and errors inside outgoing bubbles.
  ...cross(['chat-meta'], ['chat-incoming', 'chat-outgoing', 'chat-canvas']),
  ...cross(
    ['status-info-fg', 'status-success-fg', 'status-error-fg', 'action-primary'],
    ['chat-outgoing'],
  ),
  ['chat-note-fg', 'chat-note'],
  ['status-warning-fg', 'chat-note'],
  // Template categories and avatar identities.
  ...cross(['category-marketing-fg'], ['category-marketing-bg', 'surface']),
  ...cross(['category-authentication-fg'], ['category-authentication-bg', 'surface']),
  ...AVATARS.map((a): Pair => [`avatar-${a}-fg`, `avatar-${a}-bg`]),
  // Contact labels: text on its own tint.
  ...LABELS.map((l): Pair => [`label-${l}-fg`, `label-${l}-bg`]),
]

/** Non-text pairs that must clear 3:1 (WCAG 1.4.11): indicators, icons, focus, chart marks. */
const NON_TEXT_PAIRS: Pair[] = [
  // Header WhatsApp status dots on the header surface (shown with a label or shape icon).
  ['status-success', 'surface'],
  ['status-error', 'surface'],
  ['status-warning', 'surface'],
  ['status-neutral', 'surface'],
  // Sidebar: the emerald selected bar and the focus ring (drawn inside the row) on every row state.
  ['sidebar-item-selected-indicator', 'sidebar-item-selected'],
  ['sidebar-item-selected-indicator', 'sidebar-item-selected-hover'],
  ['focus-ring', 'sidebar'],
  ['focus-ring', 'sidebar-item-hover'],
  ['focus-ring', 'sidebar-item-selected'],
  ['focus-ring', 'sidebar-item-selected-hover'],
  ...cross(
    ['focus-ring'],
    ['canvas', 'sidebar', 'surface', 'surface-muted', 'surface-selected', 'chat-canvas'],
  ),
  ...cross(['focus-ring'], ['action-primary-subtle']),
  ...cross(['fg-subtle'], ['canvas', 'sidebar', 'surface', 'surface-muted']),
  ...cross(['border-control-strong'], ['surface', 'surface-muted']),
  // Checked checkbox/switch fill and selection rings.
  ...cross(['action-primary'], ['surface', 'canvas', 'surface-selected']),
  ...cross(['action-danger'], ['surface']),
  ...STATUSES.map((s): Pair => [`status-${s}`, 'surface']),
  ...ACCENTS.map((a): Pair => [`accent-${a}`, 'surface']),
  // Delivery ticks on both bubbles: grey sent/delivered, blue read, red failed.
  ...cross(['chat-meta', 'chat-read', 'status-error'], ['chat-incoming', 'chat-outgoing']),
  ...([1, 2, 3, 4, 5, 6] as const).map((n): Pair => [`chart-${n}`, 'surface']),
  ...(
    [
      'chart-stage-1',
      'chart-stage-2',
      'chart-stage-3',
      'chart-blue',
      'chart-orange',
      'chart-violet',
      'chart-aqua',
      'chart-good',
      'chart-critical',
      'chart-other',
    ] as const
  ).map((token): Pair => [token, 'surface']),
]

describe('color tokens', () => {
  it('keeps the approved Graphite + Emerald palette', () => {
    const approved: Record<string, [light: string, dark: string]> = {
      canvas: ['#F6F7F9', '#111315'],
      sidebar: ['#F0F2F5', '#15181C'],
      surface: ['#FFFFFF', '#1B1E22'],
      'surface-elevated': ['#FFFFFF', '#252A30'],
      'surface-muted': ['#F0F2F5', '#22272D'],
      'surface-hover': ['#E9EDF2', '#2A3038'],
      'surface-selected': ['#DEE5ED', '#35404D'],
      scrim: ['#111315', '#000000'],
      fg: ['#20252C', '#F1F3F5'],
      'fg-secondary': ['#586270', '#B6BFCB'],
      'fg-disabled': ['#9AA3AF', '#657080'],
      'fg-subtle': ['#737F8F', '#8995A5'],
      'border-subtle': ['#E1E5EB', '#303740'],
      'border-control': ['#BCC5D0', '#596575'],
      'border-control-strong': ['#737F8F', '#8995A5'],
      'action-primary': ['#047857', '#10B981'],
      'action-primary-hover': ['#065F46', '#34D399'],
      // Dark pressed lightened from #059669 so dark label text clears AA.
      'action-primary-pressed': ['#064E3B', '#05A271'],
      // Light muted darkened from #657080 to clear AA on hover/selected surfaces.
      'fg-muted': ['#5D6776', '#A0ACBC'],
      'action-primary-fg': ['#FFFFFF', '#052E24'],
      'action-primary-subtle': ['#EAF5F0', '#17382D'],
      'action-primary-subtle-fg': ['#065F46', '#6EE7B7'],
      'action-danger': ['#B91C1C', '#F87171'],
      'action-danger-hover': ['#991B1B', '#FCA5A5'],
      'action-danger-fg': ['#FFFFFF', '#450A0A'],
      'focus-ring': ['#047857', '#10B981'],
      link: ['#334155', '#CBD5E1'],
      'link-hover': ['#20252C', '#F1F3F5'],
      brand: ['#00A884', '#10B981'],
      whatsapp: ['#25D366', '#25D366'],
      'sidebar-item-hover': ['#DEE5ED', '#262D36'],
      'sidebar-item-selected': ['#D6DFE9', '#354251'],
      'sidebar-item-selected-fg': ['#192431', '#F4F7FA'],
      'sidebar-item-selected-indicator': ['#047857', '#10B981'],
      'status-success': ['#16A34A', '#4ADE80'],
      'status-success-fg': ['#166534', '#86EFAC'],
      'status-success-bg': ['#DCFCE7', '#14281B'],
      'status-warning': ['#D97706', '#FBBF24'],
      'status-warning-fg': ['#9A4D0B', '#FCD34D'],
      'status-warning-bg': ['#FEF3C7', '#2E2410'],
      'status-error': ['#DC2626', '#F87171'],
      'status-error-fg': ['#B91C1C', '#FCA5A5'],
      'status-error-bg': ['#FEE2E2', '#331A1A'],
      'status-info': ['#2563EB', '#60A5FA'],
      'status-info-fg': ['#1D4ED8', '#93C5FD'],
      'status-info-bg': ['#EFF6FF', '#17233A'],
      'status-neutral': ['#737F8F', '#8995A5'],
      'status-neutral-fg': ['#586270', '#B6BFCB'],
      'status-neutral-bg': ['#F0F2F5', '#2A3038'],
      'accent-conversation': ['#2563EB', '#60A5FA'],
      'accent-automation': ['#7C3AED', '#A78BFA'],
      'chat-canvas': ['#F1F3F5', '#14191D'],
      'chat-incoming': ['#FFFFFF', '#252C33'],
      'chat-incoming-fg': ['#20252C', '#F1F3F5'],
      'chat-outgoing': ['#E0EFE7', '#1C3B32'],
      'chat-outgoing-fg': ['#20252C', '#F1F3F5'],
      'chat-meta': ['#586270', '#B6BFCB'],
      'chat-read': ['#2563EB', '#60A5FA'],
      'chat-note': ['#FFF6DF', '#352B18'],
      'chat-note-fg': ['#785014', '#F8DFA0'],
      'chat-note-border': ['#E7C777', '#8A6829'],
      'label-blue-bg': ['#EFF6FF', '#17233A'],
      'label-blue-fg': ['#1D4ED8', '#93C5FD'],
      'label-green-bg': ['#DCFCE7', '#14281B'],
      'label-green-fg': ['#166534', '#86EFAC'],
      'label-teal-bg': ['#CFF3E8', '#163329'],
      'label-teal-fg': ['#065F46', '#8FE3C6'],
      'label-amber-bg': ['#FEF3C7', '#2E2410'],
      'label-amber-fg': ['#92400E', '#FCD34D'],
      'label-rose-bg': ['#FFF1F2', '#351D29'],
      'label-rose-fg': ['#BE123C', '#FDA4AF'],
      'label-neutral-bg': ['#F0F2F5', '#2A3038'],
      'label-neutral-fg': ['#586270', '#B6BFCB'],
    }
    for (const [token, [light, dark]] of Object.entries(approved)) {
      expect(themes.light[token as ColorToken], `light ${token}`).toBe(light)
      expect(themes.dark[token as ColorToken], `dark ${token}`).toBe(dark)
    }
  })

  it('defines every semantic and component role for both themes', () => {
    const roles = Object.keys({ ...semanticTokens, ...componentTokens })
    for (const theme of ['light', 'dark'] as const)
      for (const role of roles) expect(themes[theme], `${theme} ${role}`).toHaveProperty(role)
  })

  it('uses uppercase 6-digit hex primitives only', () => {
    const values = Object.values(palette).flatMap((v) =>
      typeof v === 'string' ? [v] : Object.values(v),
    )
    for (const value of values) expect(value).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('resolves palette references and rejects unknown ones', () => {
    expect(resolvePaletteRef('graphite.25')).toBe('#F6F7F9')
    expect(() => resolvePaletteRef('graphite.13' as never)).toThrow()
  })

  it('points every deprecated alias at a semantic token in both themes', () => {
    for (const [alias, target] of Object.entries(tokenAliases))
      for (const theme of ['light', 'dark'] as const)
        expect(themes[theme][alias as ColorToken]).toBe(themes[theme][target])
    expect(colorTokens).toBe(themes.light)
  })

  it('keeps brand emerald, success green, chat green and WhatsApp green separate', () => {
    for (const theme of ['light', 'dark'] as const) {
      const t = themes[theme]
      const greens = [t.brand, t['status-success'], t['chat-outgoing'], t.whatsapp]
      expect(new Set(greens).size, theme).toBe(greens.length)
      expect(t['action-primary']).not.toBe(t['status-success'])
    }
  })

  it('keeps application surfaces neutral graphite (no green tint)', () => {
    const roles: ColorToken[] = [
      'canvas',
      'sidebar',
      'surface',
      'surface-elevated',
      'surface-muted',
      'surface-hover',
      'surface-selected',
      'sidebar-item-hover',
      'sidebar-item-selected',
      'chat-canvas',
      'chat-incoming',
    ]
    for (const theme of ['light', 'dark'] as const)
      for (const role of roles) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(themes[theme][role].slice(i, i + 2), 16))
        // Cool graphite: blue may lead slightly; green never exceeds blue.
        expect(g!, `${theme} ${role}`).toBeLessThanOrEqual(b!)
        expect(b! - r!, `${theme} ${role}`).toBeLessThanOrEqual(28)
      }
  })

  it('orders resting, hover and selected states (selection always the strongest fill)', () => {
    // A structural check, not an accessibility guarantee: each step must be a distinct, darker
    // (light) or lighter (dark) fill than the one before it. Selection is additionally carried by
    // the semibold label and the emerald indicator (3:1, above); focus has its own ring.
    for (const theme of ['light', 'dark'] as const) {
      const t = themes[theme]
      for (const steps of [
        ['sidebar', 'sidebar-item-hover', 'sidebar-item-selected'],
        ['surface', 'list-item-hover', 'surface-selected'],
      ] as const) {
        const l = steps.map((token) => lum(t[token]))
        const ordered =
          theme === 'light' ? l[0]! > l[1]! && l[1]! > l[2]! : l[0]! < l[1]! && l[1]! < l[2]!
        expect(
          ordered,
          `${theme} ${steps.join(' → ')} (${steps.map((x) => t[x]).join(' → ')})`,
        ).toBe(true)
      }
      // Selected keeps its fill on hover.
      expect(t['sidebar-item-selected-hover']).toBe(t['sidebar-item-selected'])
    }
  })

  it('names CSS variables consistently', () => {
    expect(cssVar('surface-muted')).toBe('--color-surface-muted')
    expect(cssVar('primary-soft')).toBe('--color-primary-soft')
  })

  it('generates styles/tokens.css from tokens.ts', async () => {
    await expect(renderThemeCss()).toMatchFileSnapshot('../src/styles/tokens.css')
  })

  describe.each(['light', 'dark'] as ThemeName[])('%s theme contrast', (theme) => {
    const t = themes[theme]
    it.each(TEXT_PAIRS)('text %s on %s ≥ 4.5:1', (fg, bg) => {
      expect(ratio(t[fg], t[bg]), `${t[fg]} on ${t[bg]}`).toBeGreaterThanOrEqual(4.5)
    })
    it.each(NON_TEXT_PAIRS)('non-text %s on %s ≥ 3:1', (fg, bg) => {
      expect(ratio(t[fg], t[bg]), `${t[fg]} on ${t[bg]}`).toBeGreaterThanOrEqual(3)
    })
  })
})
