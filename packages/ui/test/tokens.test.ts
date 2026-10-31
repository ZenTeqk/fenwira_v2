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
  ...cross(['fg', 'fg-secondary', 'fg-muted'], TEXT_SURFACES),
  // Green links/text and selected navigation (never on the neutral selected surface).
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
  ...cross(['action-primary-fg', 'surface'], ['action-primary', 'action-primary-hover']),
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
]

/** Non-text pairs that must clear 3:1 (WCAG 1.4.11): indicators, icons, focus, chart marks. */
const NON_TEXT_PAIRS: Pair[] = [
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
  it('keeps the approved light foundation', () => {
    expect(themes.light).toMatchObject({
      canvas: '#F5F5F4',
      sidebar: '#EFEFED',
      surface: '#FFFFFF',
      'surface-muted': '#F0F0ED',
      'surface-selected': '#E7E7E4',
      'border-subtle': '#DEDED8',
      fg: '#242622',
      'fg-secondary': '#62665E',
      'action-primary': '#047857',
      'action-primary-hover': '#065F46',
      'action-primary-fg': '#FFFFFF',
      'chat-canvas': '#F3F0EA',
      'chat-incoming': '#FFFFFF',
      'chat-outgoing': '#DDEED5',
      'chat-read': '#2563EB',
      whatsapp: '#25D366',
    })
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
    expect(resolvePaletteRef('neutral.25')).toBe('#F5F5F4')
    expect(() => resolvePaletteRef('neutral.13' as never)).toThrow()
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

  it('keeps dark application surfaces neutral (no blue or green cast)', () => {
    const roles: ColorToken[] = [
      'canvas',
      'sidebar',
      'surface',
      'surface-elevated',
      'surface-muted',
      'surface-hover',
      'surface-selected',
      'chat-canvas',
      'chat-incoming',
    ]
    for (const role of roles) {
      const hex = themes.dark[role]
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), role).toBeLessThanOrEqual(4)
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
