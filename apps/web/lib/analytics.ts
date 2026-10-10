'use client'

import { type AnalyticsMeta, type Kpi, type Rate } from '@fenwira/contracts'
import { type MetricDelta } from '@fenwira/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

export type AnalyticsView =
  'overview' | 'messaging' | 'campaigns' | 'inbox' | 'automations' | 'usage'

/**
 * The date range shared by every Analytics tab (kept for the browser session). Presets are sent
 * as `days` and resolved by the server in the workspace timezone; custom dates are workspace-local
 * days too. The browser's own timezone never changes the figures (docs/ANALYTICS.md).
 */
export type AnalyticsRange =
  { kind: 'preset'; days: 1 | 7 | 30 | 90 } | { kind: 'custom'; from: string; to: string }

const STORAGE_KEY = 'fenwira.analytics.range'
const DEFAULT_RANGE: AnalyticsRange = { kind: 'preset', days: 30 }

export function useAnalyticsRange(): [AnalyticsRange, (r: AnalyticsRange) => void] {
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_RANGE)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) setRange(JSON.parse(saved) as AnalyticsRange)
    } catch {
      // Storage unavailable: keep the default.
    }
  }, [])
  const set = useCallback((r: AnalyticsRange) => {
    setRange(r)
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r))
    } catch {
      // Not persisted; the range still applies to this page.
    }
  }, [])
  return [range, set]
}

export const rangeQuery = (r: AnalyticsRange) =>
  r.kind === 'preset' ? `days=${r.days}` : `from=${r.from}&to=${r.to}`

export function useAnalytics<T extends { meta: AnalyticsMeta }>(
  view: AnalyticsView,
  range: AnalyticsRange,
  enabled = true,
) {
  const { tenantId } = useSession()
  const q = rangeQuery(range)
  return useQuery({
    queryKey: keys.tenant(tenantId, 'analytics', view, q),
    queryFn: () => get<T>(`/analytics/${view}?${q}`),
    enabled: enabled && Boolean(tenantId),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
}

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

/** Change of a count against the previous period. `upIsGood` sets the arrow's tone. */
export function countDelta(k: Kpi, upIsGood = true): MetricDelta | undefined {
  if (k.previous === null) return undefined
  const diff = k.value - k.previous
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const sentiment =
    direction === 'flat' ? 'neutral' : (direction === 'up') === upIsGood ? 'positive' : 'negative'
  const value =
    k.previous === 0
      ? diff === 0
        ? 'No change'
        : `+${count(diff)}`
      : `${diff > 0 ? '+' : ''}${((diff / k.previous) * 100).toFixed(0)}%`
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
