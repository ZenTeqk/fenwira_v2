import { type Kpi, type Rate, type SeriesPoint } from '@fenwira/contracts'
import { type MetricDelta } from '@fenwira/ui'

/** Pure analytics formatting and transforms (no React), shared by every Analytics view. */

// ------------------------------------------------------------------------------ formatting

export const count = (n: number) => n.toLocaleString('en-IN')

/** A rate, or "—" when there is nothing to divide by (never a misleading 0 %). */
export const percent = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toFixed(v >= 0.9995 || v === 0 ? 0 : 1)}%`

export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** A day (YYYY-MM-DD) as "28 Sep". */
export const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/**
 * Change of a count against the previous period. `upIsGood` sets the arrow's tone; pass
 * `'neutral'` for volumes whose direction is neither good nor bad (messages sent, charges).
 * A previous value of 0 gives the absolute change (in `format`), never an infinite percentage.
 */
export function countDelta(
  k: Kpi,
  upIsGood: boolean | 'neutral' = true,
  format: (n: number) => string = count,
): MetricDelta | undefined {
  if (k.previous === null) return undefined
  const diff = k.value - k.previous
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const sentiment =
    direction === 'flat' || upIsGood === 'neutral'
      ? 'neutral'
      : (direction === 'up') === upIsGood
        ? 'positive'
        : 'negative'
  if (k.previous === 0)
    return diff === 0
      ? { value: 'No change', direction, sentiment, label: 'vs previous period' }
      : { value: `+${format(diff)}`, direction, sentiment, label: 'vs none in the previous period' }
  const pct = (diff / k.previous) * 100
  const value = `${diff > 0 ? '+' : ''}${Math.abs(pct) < 0.5 && diff !== 0 ? pct.toFixed(1) : pct.toFixed(0)}%`
  return { value, direction, sentiment, label: 'vs previous period' }
}

/** Change of a rate, in percentage points; none when either period has no rate. */
export function rateDelta(r: Rate, upIsGood = true): MetricDelta | undefined {
  if (r.value === null || r.previous === null) return undefined
  const pts = (r.value - r.previous) * 100
  const direction = Math.abs(pts) < 0.05 ? 'flat' : pts > 0 ? 'up' : 'down'
  const sentiment =
    direction === 'flat' ? 'neutral' : (direction === 'up') === upIsGood ? 'positive' : 'negative'
  return {
    value: `${pts > 0 ? '+' : ''}${pts.toFixed(1)} pts`,
    direction,
    sentiment,
    label: 'vs previous period',
  }
}

/** "412 of 430 sent" style explanation for a rate. */
export const rateHint = (r: Rate, of: string) =>
  r.denominator === 0
    ? `No ${of} in this period`
    : `${count(r.numerator)} of ${count(r.denominator)} ${of}`

// ------------------------------------------------------------------------- overview series

/** Latest-status buckets, bottom of a stack first. Each outbound message is in exactly one. */
export const LATEST_STATUS_KEYS = ['read', 'deliveredOnly', 'sentOnly', 'failed'] as const
export type LatestStatusKey = (typeof LATEST_STATUS_KEYS)[number]

/**
 * The messaging series counts nested status classes of one daily cohort (messages created that
 * day, by their current status: Sent ⊇ Delivered ⊇ Read; Failed is a separate status;
 * docs/ANALYTICS.md → Messaging), so its values must never be stacked as they are. Subtracting the
 * nested classes gives each message's latest status exactly once: READ, DELIVERED (not read),
 * SENT (not delivered) and FAILED. Their sum is every message with a final status; pending
 * messages are excluded.
 *
 * Returns null when any day breaks read ≤ delivered ≤ sent (or has a negative count), instead of
 * clamping: the caller then shows the original counts as grouped columns.
 */
export function latestStatusSeries(series: SeriesPoint[]): Array<{
  day: string
  values: Record<LatestStatusKey, number>
}> | null {
  const out: Array<{ day: string; values: Record<LatestStatusKey, number> }> = []
  for (const { day, values } of series) {
    const sent = values.sent ?? 0
    const delivered = values.delivered ?? 0
    const read = values.read ?? 0
    const failed = values.failed ?? 0
    if (read < 0 || failed < 0 || read > delivered || delivered > sent) return null
    out.push({
      day,
      values: { read, deliveredOnly: delivered - read, sentOnly: sent - delivered, failed },
    })
  }
  return out
}

/** Days in the series with any outbound activity (every day of the range is present). */
export function activeDays(series: SeriesPoint[]): { active: number; total: number } {
  const active = series.filter((p) => Object.values(p.values).some((v) => v > 0)).length
  return { active, total: series.length }
}
