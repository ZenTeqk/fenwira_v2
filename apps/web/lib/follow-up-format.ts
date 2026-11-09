import { zonedTimeToUtc } from '@fenwira/contracts'

/**
 * Pure display and input helpers for follow-ups and sales (no React): workspace-timezone dates
 * and integer minor-unit money (docs/FOLLOW_UPS_AND_SALES.md).
 */

const formatters = new Map<string, Intl.DateTimeFormat>()
/** "Mon 9 Nov, 5:30 pm" in the workspace timezone. */
export function formatDue(iso: string, timeZone: string): string {
  const key = `due:${timeZone}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
    formatters.set(key, f)
  }
  return f.format(new Date(iso))
}

/** The workspace-local date and time of an instant, for date/time inputs. */
export function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00'
  return { date: `${v('year')}-${v('month')}-${v('day')}`, time: `${v('hour')}:${v('minute')}` }
}

/** Date and time typed in the workspace timezone → UTC ISO string for the API. */
export const toUtcIso = (date: string, time: string, timeZone: string) =>
  zonedTimeToUtc(date, time, timeZone).toISOString()

/** Quick picks for a due time, in the workspace timezone. */
export function quickDue(
  kind: 'later' | 'tomorrow' | 'nextWeek',
  timeZone: string,
  now = new Date(),
) {
  if (kind === 'later') {
    const at = new Date(now.getTime() + 3 * 3600_000)
    return zonedParts(at.toISOString(), timeZone)
  }
  const today = zonedParts(now.toISOString(), timeZone).date
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const add = kind === 'tomorrow' ? 1 : 7
  const date = new Date(Date.UTC(y, m - 1, d + add)).toISOString().slice(0, 10)
  return { date, time: '10:00' }
}

// ------------------------------------------------------------------------------- money

/** Fraction digits for a currency (INR 2, JPY 0). */
export function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * "12,345.5" → 1234550 minor units, by string arithmetic only (no floating point). Returns null
 * for an empty input and undefined for an invalid one.
 */
export function parseMoney(input: string, currency: string): number | null | undefined {
  const text = input.replace(/[,\s]/g, '')
  if (!text) return null
  const digits = fractionDigits(currency)
  const match = /^(\d{1,13})(?:\.(\d*))?$/.exec(text)
  if (!match) return undefined
  const [, whole, frac = ''] = match
  if (frac.length > digits) return undefined
  const minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt(frac.padEnd(digits, '0') || '0')
  return minor > 10_000_000_000_000n ? undefined : Number(minor)
}

/** Minor units → "₹12,345.50" without floating point (Intl accepts a decimal string). */
export function formatMoney(minor: number, currency: string): string {
  const digits = fractionDigits(currency)
  const s = String(minor).padStart(digits + 1, '0')
  const decimal = digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      decimal as unknown as number,
    )
  } catch {
    return `${currency} ${decimal}`
  }
}

/** Minor units → the editable decimal text ("12345.50"). */
export function moneyInput(minor: number | null, currency: string): string {
  if (minor === null) return ''
  const digits = fractionDigits(currency)
  const s = String(minor).padStart(digits + 1, '0')
  return digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s
}

/** "4m", "1h 20m", "2d". */
export function waitedFor(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
