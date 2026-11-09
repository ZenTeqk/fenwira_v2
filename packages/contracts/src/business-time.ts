import { type BusinessHours } from './automation/reply-studio'

/**
 * Business-time arithmetic over the workspace's shared business-hours schedule (Reply Studio →
 * Business hours: timezone, Monday-first week, holidays). Pure functions, used by the response
 * alert worker and its tests (docs/RESPONSE_ALERTS.md → Timer semantics). Opening and closing
 * times are wall-clock times in the schedule's timezone, so a DST change moves the instants, not
 * the hours. Closing is exclusive.
 */

const MINUTE = 60_000
/** How far ahead (local days) the arithmetic searches before concluding "never". */
const MAX_DAYS = 400

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  return f
}

function partsAt(timeZone: string, at: number): Parts & { second: number } {
  const out: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(at)))
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  }
}

/** Offset of `timeZone` from UTC at the instant `at`, in ms (IST → +19 800 000). */
function offsetAt(timeZone: string, at: number): number {
  const p = partsAt(timeZone, at)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - Math.floor(at / 1000) * 1000
}

/** The local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDate(timeZone: string, at: Date): string {
  const p = partsAt(timeZone, at.getTime())
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** `date` plus `days` calendar days (pure date arithmetic, no timezone). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `time`. Across a DST gap (a wall
 * time that never happens) the result moves forward by the gap; in an overlap the earlier instant
 * wins.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const naive = Date.UTC(y, m - 1, d, hh, mm)
  const first = offsetAt(timeZone, naive)
  let at = naive - first
  const second = offsetAt(timeZone, at)
  if (second !== first) {
    const retry = naive - second
    const p = partsAt(timeZone, retry)
    if (p.hour === hh && p.minute === mm) at = retry
  }
  // Overlap: prefer the earlier of two valid instants.
  const earlier = at - 3_600_000
  const pe = partsAt(timeZone, earlier)
  if (pe.year === y && pe.month === m && pe.day === d && pe.hour === hh && pe.minute === mm)
    at = earlier
  return new Date(at)
}

/** Start and end (exclusive) of the local calendar day containing `at`. */
export function localDayBounds(timeZone: string, at: Date): { start: Date; end: Date } {
  const date = localDate(timeZone, at)
  return {
    start: zonedTimeToUtc(date, '00:00', timeZone),
    end: zonedTimeToUtc(addDays(date, 1), '00:00', timeZone),
  }
}

/** The open interval of one local date, or null when the business is closed that day. */
function openInterval(
  schedule: BusinessHours,
  date: string,
): { open: number; close: number } | null {
  if (schedule.holidays.includes(date)) return null
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // Monday = 0
  const day = schedule.week[weekday]
  if (!day || day.closed) return null
  const open = zonedTimeToUtc(date, day.open, schedule.timezone).getTime()
  const close = zonedTimeToUtc(date, day.close, schedule.timezone).getTime()
  return close > open ? { open, close } : null
}

/** Whether the schedule has any open hours at all (otherwise business time never passes). */
export function hasBusinessHours(schedule: BusinessHours): boolean {
  return schedule.week.some((d) => !d.closed && d.open < d.close)
}

/** Business minutes (fractional) between two instants. Zero when `to` is not after `from`. */
export function businessMinutesBetween(schedule: BusinessHours, from: Date, to: Date): number {
  const start = from.getTime()
  const end = to.getTime()
  if (end <= start) return 0
  let total = 0
  let date = localDate(schedule.timezone, from)
  const last = localDate(schedule.timezone, to)
  // Bounded: a waiting episode spans days, never years.
  for (let i = 0; i <= MAX_DAYS * 5; i++) {
    const interval = openInterval(schedule, date)
    if (interval) {
      const overlap = Math.min(interval.close, end) - Math.max(interval.open, start)
      if (overlap > 0) total += overlap
    }
    if (date >= last) break
    date = addDays(date, 1)
  }
  return total / MINUTE
}

/**
 * The instant at which `minutes` business minutes have passed since `from`; null when the
 * schedule never opens within the search horizon (no business hours configured).
 */
export function addBusinessMinutes(
  schedule: BusinessHours,
  from: Date,
  minutes: number,
): Date | null {
  let remaining = minutes * MINUTE
  const start = from.getTime()
  let date = localDate(schedule.timezone, from)
  // The day before too: an interval can't start before `from`, but checking it is harmless and
  // keeps the loop simple around midnight in far-east/far-west timezones.
  date = addDays(date, -1)
  for (let i = 0; i < MAX_DAYS; i++) {
    const interval = openInterval(schedule, date)
    if (interval) {
      const begin = Math.max(interval.open, start)
      const length = interval.close - begin
      if (length > 0) {
        if (length >= remaining) return new Date(begin + remaining)
        remaining -= length
      }
    }
    date = addDays(date, 1)
  }
  return null
}
