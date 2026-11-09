import { describe, expect, it } from 'vitest'
import {
  addBusinessMinutes,
  type BusinessHours,
  businessMinutesBetween,
  hasBusinessHours,
  localDate,
  localDayBounds,
  zonedTimeToUtc,
} from '../src'

const weekdays = (timezone: string, holidays: string[] = []): BusinessHours => ({
  timezone,
  week: Array.from({ length: 7 }, (_, i) => ({ closed: i > 4, open: '09:00', close: '18:00' })),
  holidays,
})
const IST = weekdays('Asia/Kolkata')
const at = (iso: string) => new Date(iso)

describe('business time (docs/RESPONSE_ALERTS.md → Timer semantics)', () => {
  it('converts workspace wall-clock times to instants', () => {
    // 2026-11-09 is a Monday. 09:00 IST = 03:30 UTC.
    expect(zonedTimeToUtc('2026-11-09', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-09T03:30:00.000Z',
    )
    expect(localDate('Asia/Kolkata', at('2026-11-09T20:00:00Z'))).toBe('2026-11-10')
  })

  it('counts only open minutes within a day', () => {
    // 10:00 → 10:30 IST on a Monday.
    expect(
      businessMinutesBetween(IST, at('2026-11-09T04:30:00Z'), at('2026-11-09T05:00:00Z')),
    ).toBe(30)
    // 17:50 → 19:00 IST: only 10 minutes before closing count.
    expect(
      businessMinutesBetween(IST, at('2026-11-09T12:20:00Z'), at('2026-11-09T13:30:00Z')),
    ).toBe(10)
  })

  it('continues across days and skips weekends and holidays', () => {
    // Friday 17:55 IST + 15 business minutes → Monday 09:10 IST.
    const friday = at('2026-11-13T12:25:00Z')
    expect(addBusinessMinutes(IST, friday, 15)?.toISOString()).toBe('2026-11-16T03:40:00.000Z')
    // Same, with Monday a holiday → Tuesday 09:10 IST.
    const holiday = weekdays('Asia/Kolkata', ['2026-11-16'])
    expect(addBusinessMinutes(holiday, friday, 15)?.toISOString()).toBe('2026-11-17T03:40:00.000Z')
    expect(businessMinutesBetween(IST, friday, at('2026-11-16T03:40:00Z'))).toBe(15)
  })

  it('starts counting at opening time when a message arrives before hours', () => {
    // Monday 07:00 IST + 5 → 09:05 IST.
    expect(addBusinessMinutes(IST, at('2026-11-09T01:30:00Z'), 5)?.toISOString()).toBe(
      '2026-11-09T03:35:00.000Z',
    )
  })

  it('keeps wall-clock hours across a DST change', () => {
    const ny = weekdays('America/New_York')
    // US DST ended Sunday 2026-11-01. Friday 17:50 EDT (21:50Z) + 20 → Monday 09:10 EST (14:10Z).
    expect(addBusinessMinutes(ny, at('2026-10-30T21:50:00Z'), 20)?.toISOString()).toBe(
      '2026-11-02T14:10:00.000Z',
    )
    // 9 open hours on each side of the change.
    expect(businessMinutesBetween(ny, at('2026-10-30T00:00:00Z'), at('2026-11-03T00:00:00Z'))).toBe(
      2 * 9 * 60,
    )
    // The change day itself is 25 hours long in local time.
    const day = localDayBounds('America/New_York', at('2026-11-01T12:00:00Z'))
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * 3600 * 1000)
  })

  it('never fires when the schedule has no open hours', () => {
    const closed: BusinessHours = {
      ...IST,
      week: IST.week.map((d) => ({ ...d, closed: true })),
    }
    expect(hasBusinessHours(closed)).toBe(false)
    expect(addBusinessMinutes(closed, at('2026-11-09T04:30:00Z'), 5)).toBeNull()
    expect(
      businessMinutesBetween(closed, at('2026-11-09T00:00:00Z'), at('2026-11-12T00:00:00Z')),
    ).toBe(0)
  })

  it('gives the workspace-local calendar day for Today', () => {
    // 18:00Z is 23:30 IST on Monday: still Monday in the workspace, though UTC agrees here.
    const day = localDayBounds('Asia/Kolkata', at('2026-11-09T18:00:00Z'))
    expect(day.start.toISOString()).toBe('2026-11-08T18:30:00.000Z')
    expect(day.end.toISOString()).toBe('2026-11-09T18:30:00.000Z')
  })
})
