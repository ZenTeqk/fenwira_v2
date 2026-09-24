import { describe, expect, it } from 'vitest'
import { colorTokens, cssVar } from '../src'

describe('color tokens', () => {
  it('matches the design-system contract exactly', () => {
    expect(colorTokens).toMatchObject({
      primary: '#00A884',
      'primary-hover': '#008F70',
      success: '#25D366',
      slate: '#0F172A',
      background: '#F8FAFC',
      surface: '#FFFFFF',
      border: '#E2E8F0',
      info: '#6366F1',
    })
    expect(Object.keys(colorTokens)).toHaveLength(22)
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
      [t['slate-400'], t.slate],
      [t['slate-800'], t['neutral-soft']],
    ]
    for (const [fg, bg] of pairs)
      expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    // Documented exclusion: muted on neutral-soft is below AA and must not be used.
    expect(ratio(t.muted, t['neutral-soft'])).toBeLessThan(4.5)
  })
})
