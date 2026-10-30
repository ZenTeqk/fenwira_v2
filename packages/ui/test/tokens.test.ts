import { describe, expect, it } from 'vitest'
import { colorTokens, cssVar } from '../src'

describe('color tokens', () => {
  it('matches the design-system contract exactly', () => {
    expect(colorTokens).toMatchObject({
      primary: '#00A884',
      'primary-hover': '#008F70',
      success: '#16A34A',
      slate: '#18201D',
      background: '#F7F7F4',
      surface: '#FFFFFF',
      border: '#E5E7E3',
      'border-strong': '#D6D9D4',
      secondary: '#4B5550',
      muted: '#66716B',
      whatsapp: '#25D366',
      warning: '#F59E0B',
      danger: '#DC2626',
      info: '#2563EB',
      'message-outbound': '#D2F2DF',
    })
    expect(Object.keys(colorTokens)).toHaveLength(57)
  })

  it('uses uppercase 6-digit hex only', () => {
    for (const value of Object.values(colorTokens)) expect(value).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('names CSS variables consistently', () => {
    expect(cssVar('primary-soft')).toBe('--color-primary-soft')
  })
  it('keeps every text/fill pairing at WCAG AA (4.5:1)', () => {
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
    const t = colorTokens
    const pairs: Array<[string, string]> = [
      [t.surface, t['primary-strong']],
      [t.surface, t['primary-strong-hover']],
      [t.surface, t['danger-strong']],
      [t.surface, t['info-strong']],
      [t['primary-strong'], t.background],
      [t['primary-strong'], t['primary-soft']],
      [t['danger-strong'], t['danger-soft']],
      [t.slate, t['success-soft']],
      [t.slate, t['primary-soft']],
      [t.muted, t.surface],
      [t.muted, t.background],
      [t.muted, t['neutral-soft']],
      [t.muted, t['primary-soft']],
      [t.secondary, t.sidebar],
      [t['primary-strong'], t.sidebar],
      [t['slate-400'], t.slate],
      [t['slate-800'], t['neutral-soft']],
      [t.surface, t['inbox-primary']],
      [t.surface, t['inbox-primary-hover']],
      [t['inbox-primary'], t['inbox-selected']],
      [t['inbox-text'], t['inbox-outbound']],
      [t['inbox-secondary'], t.surface],
      // The supplied secondary color is used on white; bubble metadata uses main text.
      [t['inbox-text'], t['inbox-outbound']],
      [t['inbox-note-text'], t['inbox-note']],
      [t['inbox-followup-text'], t['inbox-followup']],
      ...(['pink', 'lavender', 'peach', 'mint', 'blue'] as const).map((tone): [string, string] => [
        t[`avatar-${tone}-text`],
        t[`avatar-${tone}`],
      ]),
      // Design System v1 additions
      [t.surface, t['danger-strong-hover']],
      [t.surface, t.danger],
      [t.surface, t.info],
      [t['info-strong'], t['info-soft']],
      [t['success-strong'], t.surface],
      [t['success-strong'], t['success-soft']],
      [t['warning-strong'], t.surface],
      [t['warning-strong'], t['warning-soft']],
      [t.secondary, t.surface],
      [t.secondary, t.background],
      [t.secondary, t['neutral-soft']],
      [t.slate, t['warning-soft']],
      [t.slate, t['info-soft']],
      [t.slate, t['danger-soft']],
      [t.slate, t['message-outbound']],
      [t.secondary, t['message-outbound']],
      [t['info-strong'], t['message-outbound']],
      [t['success-strong'], t['message-outbound']],
      [t['danger-strong'], t['message-outbound']],
      // Message statuses have no warning category; warning text is on its own note/window surface.
      [t['warning-strong'], t['note-soft']],
      ...(['thread-soft', 'note-soft'] as const).flatMap((bg): Array<[string, string]> =>
        [t.slate, t.secondary, t.muted].map((fg) => [fg, t[bg]]),
      ),
    ]
    for (const [fg, bg] of pairs)
      expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    // Screenshot decorative muted fails AA, so text must use the accessible muted token.
    expect(ratio(t['muted-decorative'], t.surface)).toBeLessThan(4.5)
    // Focus outlines need 3:1 against warm surfaces (1.4.11).
    expect(ratio(t['primary-strong'], t.background)).toBeGreaterThanOrEqual(3)
    // Inbox ticks are non-text icons on the outbound bubble (1.4.11, 3:1): grey sent/delivered,
    // blue read, red failed. Each also has an accessible label, never colour alone.
    for (const fg of [t.muted, t.info, t.danger])
      expect(ratio(fg, t['message-outbound']), `${fg} tick`).toBeGreaterThanOrEqual(3)
    // …and muted stays non-text there: it fails AA as text on the outbound tint.
    expect(ratio(t.muted, t['message-outbound'])).toBeLessThan(4.5)
    // Status colors are never text: success/warning fills fail AA as text by design.
    expect(ratio(t.success, t.surface)).toBeLessThan(4.5)
    expect(ratio(t.warning, t.surface)).toBeLessThan(4.5)
  })
})
