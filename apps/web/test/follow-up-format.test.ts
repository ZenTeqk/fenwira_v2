import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  moneyInput,
  parseMoney,
  quickDue,
  toUtcIso,
  waitedFor,
  zonedParts,
} from '../lib/follow-up-format'

describe('follow-up and sales formatting', () => {
  it('parses money to integer minor units without floating point', () => {
    expect(parseMoney('12,345.5', 'INR')).toBe(1234550)
    expect(parseMoney('0.1', 'INR')).toBe(10)
    expect(parseMoney('19.99', 'INR')).toBe(1999)
    expect(parseMoney('', 'INR')).toBeNull()
    expect(parseMoney('1.234', 'INR')).toBeUndefined()
    expect(parseMoney('-5', 'INR')).toBeUndefined()
    expect(parseMoney('abc', 'INR')).toBeUndefined()
    expect(parseMoney('500', 'JPY')).toBe(500)
    expect(parseMoney('5.5', 'JPY')).toBeUndefined()
    expect(moneyInput(1234550, 'INR')).toBe('12345.50')
    expect(moneyInput(5, 'INR')).toBe('0.05')
    expect(formatMoney(1234550, 'INR')).toContain('12,345.50')
  })

  it('reads and writes due times in the workspace timezone, not the browser’s', () => {
    expect(toUtcIso('2026-11-10', '10:00', 'Asia/Kolkata')).toBe('2026-11-10T04:30:00.000Z')
    expect(zonedParts('2026-11-10T04:30:00.000Z', 'Asia/Kolkata')).toEqual({
      date: '2026-11-10',
      time: '10:00',
    })
    expect(quickDue('tomorrow', 'Asia/Kolkata', new Date('2026-11-09T20:00:00Z'))).toEqual({
      date: '2026-11-11',
      time: '10:00',
    })
  })

  it('describes how long a customer has waited', () => {
    const now = Date.parse('2026-11-09T12:00:00Z')
    expect(waitedFor('2026-11-09T11:56:00Z', now)).toBe('4m')
    expect(waitedFor('2026-11-09T10:40:00Z', now)).toBe('1h 20m')
    expect(waitedFor('2026-11-07T12:00:00Z', now)).toBe('2d')
  })
})
