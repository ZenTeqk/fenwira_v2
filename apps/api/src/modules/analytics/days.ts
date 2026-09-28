/**
 * Workspace-local days (docs/ANALYTICS.md → Time zones). Timestamps are stored in UTC; a day is
 * the calendar date in the workspace's IANA timezone, never the browser's. Days are YYYY-MM-DD.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The workspace-local date of an instant. Throws RangeError for an unknown timezone. */
export function dayIn(at: Date, timeZone: string): string {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f.format(at)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Days from `from` to `to`, both inclusive (0 when to < from). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86_400_000) + 1)
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
