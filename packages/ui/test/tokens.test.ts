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
    expect(Object.keys(colorTokens)).toHaveLength(17)
  })

  it('uses uppercase 6-digit hex only', () => {
    for (const value of Object.values(colorTokens)) expect(value).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('names CSS variables consistently', () => {
    expect(cssVar('primary-soft')).toBe('--color-primary-soft')
  })
})
