import { describe, expect, it } from 'vitest'
import { formatPhone } from '../lib/phone'

describe('formatPhone', () => {
  it('groups Indian mobile numbers', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210')
  })

  it('groups North American numbers', () => {
    expect(formatPhone('+15550102030')).toBe('+1 555-010-2030')
  })

  it('leaves other numbering plans unchanged instead of guessing', () => {
    expect(formatPhone('+447911123456')).toBe('+447911123456')
    expect(formatPhone('+9198765')).toBe('+9198765')
  })

  it('leaves non-E.164 or masked input unchanged', () => {
    expect(formatPhone('919876543210')).toBe('919876543210')
    expect(formatPhone('•••• 3210')).toBe('•••• 3210')
  })
})
