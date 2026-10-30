import { afterEach, describe, expect, it, vi } from 'vitest'
import { clockTime, shortTime } from '../lib/inbox'

const localTime = (hour: number, minute = 0) => new Date(2026, 9, 30, hour, minute).toISOString()

afterEach(() => vi.useRealTimers())

describe('inbox AM/PM timestamps', () => {
  it.each([
    [0, 7, '12:07 AM'],
    [9, 5, '9:05 AM'],
    [12, 0, '12:00 PM'],
    [13, 5, '1:05 PM'],
    [23, 59, '11:59 PM'],
  ])('formats %i:%i with the correct day period', (hour, minute, expected) => {
    expect(clockTime(localTime(hour, minute))).toBe(expected)
  })

  it('uses the same clock in the conversation list for today, retaining dates for older rows', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 16))
    expect(shortTime(localTime(13, 5))).toBe('1:05 PM')
    expect(shortTime(localTime(0, 7))).toBe('12:07 AM')
    expect(shortTime(new Date(2026, 9, 29, 13, 5).toISOString())).not.toMatch(/AM|PM/)
    expect(shortTime(null)).toBe('')
  })
})
