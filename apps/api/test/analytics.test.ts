import { describe, expect, it } from 'vitest'
import { addDays, dayIn, daysBetween, eachDay } from '../src/modules/analytics/days'

describe('workspace-local days (docs/ANALYTICS.md → Time zones)', () => {
  it('buckets an instant by the workspace timezone, not UTC or the browser', () => {
    const at = new Date('2026-09-27T19:30:00Z') // 01:00 on the 28th in Kolkata
    expect(dayIn(at, 'Asia/Kolkata')).toBe('2026-09-28')
    expect(dayIn(at, 'UTC')).toBe('2026-09-27')
    expect(dayIn(at, 'America/Los_Angeles')).toBe('2026-09-27')
  })

  it('handles DST transitions (a 23-hour and a 25-hour day)', () => {
    // New York springs forward on 2026-03-08 and falls back on 2026-11-01.
    expect(dayIn(new Date('2026-03-08T04:59:00Z'), 'America/New_York')).toBe('2026-03-07')
    expect(dayIn(new Date('2026-03-08T05:00:00Z'), 'America/New_York')).toBe('2026-03-08')
    expect(dayIn(new Date('2026-11-02T04:59:00Z'), 'America/New_York')).toBe('2026-11-01')
  })

  it('rejects an unknown timezone (recorded as a projection failure, never silently UTC)', () => {
    expect(() => dayIn(new Date(), 'Mars/Olympus_Mons')).toThrow(RangeError)
  })

  it('does day arithmetic on calendar dates', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(30)
    expect(daysBetween('2026-09-02', '2026-09-01')).toBe(0)
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
  })
})
