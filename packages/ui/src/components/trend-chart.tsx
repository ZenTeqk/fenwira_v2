'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn'

/**
 * Series colors for charts. Each meets the 3:1 non-text contrast of WCAG 1.4.11 against the
 * surface; values are never carried by color alone (legend text, table alternative, focus
 * values). docs/design/FENWIRA_DESIGN_SYSTEM.md → Charts.
 */
export type ChartTone = 'primary' | 'info' | 'success' | 'danger' | 'warning' | 'neutral'
const FILL: Record<ChartTone, string> = {
  primary: 'fill-chart-1',
  info: 'fill-chart-2',
  success: 'fill-chart-3',
  danger: 'fill-chart-4',
  warning: 'fill-chart-5',
  neutral: 'fill-chart-6',
}
const STROKE: Record<ChartTone, string> = {
  primary: 'stroke-chart-1',
  info: 'stroke-chart-2',
  success: 'stroke-chart-3',
  danger: 'stroke-chart-4',
  warning: 'stroke-chart-5',
  neutral: 'stroke-chart-6',
}
const SWATCH: Record<ChartTone, string> = {
  primary: 'bg-chart-1',
  info: 'bg-chart-2',
  success: 'bg-chart-3',
  danger: 'bg-chart-4',
  warning: 'bg-chart-5',
  neutral: 'bg-chart-6',
}

export type ChartSeries = { key: string; label: string; tone: ChartTone }
export type ChartPoint = { label: string; values: Record<string, number> }

export type TrendChartProps = {
  /** Accessible name, e.g. "Messages per day". */
  label: string
  data: ChartPoint[]
  series: ChartSeries[]
  /** line: overlapping measures (sent/delivered/read); bar: counts; stacked: parts of a whole. */
  variant?: 'line' | 'bar' | 'stacked'
  formatValue?: (v: number) => string
  /** Column header for the point labels in the table alternative. */
  pointHeader?: string
  height?: number
  className?: string
}

const PAD = { top: 12, right: 12, bottom: 28, left: 44 }

/** "Nice" axis maximum: 1, 2 or 5 × 10ⁿ at or above `max`. */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  return ([1, 2, 5, 10].find((m) => m * p >= max) ?? 10) * p
}

/**
 * A small time-series chart (Phase 11 analytics). One primary visualization per view; the same
 * numbers are available as a table ("Show as table") for screen readers and keyboard users.
 */
export function TrendChart({
  label,
  data,
  series,
  variant = 'line',
  formatValue = (v) => v.toLocaleString('en-IN'),
  pointHeader = 'Day',
  height = 220,
  className,
}: TrendChartProps) {
  const container = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const W = Math.max(240, width)
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const max = useMemo(() => {
    let m = 0
    for (const p of data) {
      const vals = series.map((s) => p.values[s.key] ?? 0)
      m = Math.max(
        m,
        variant === 'stacked' ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals),
      )
    }
    return niceMax(m)
  }, [data, series, variant])
  const x = (i: number) =>
    PAD.left + (data.length <= 1 ? plotW / 2 : (i * plotW) / (data.length - 1))
  const band = plotW / Math.max(1, data.length)
  const bx = (i: number) => PAD.left + i * band
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  // At most eight labels, at least ~64px apart. The last point is always labelled, so a sampled
  // label closer to it than one interval is dropped instead of overlapping it.
  const every = Math.max(
    1,
    Math.ceil(data.length / Math.min(8, Math.max(2, Math.floor(plotW / 64)))),
  )
  const labelled = (i: number) =>
    i === data.length - 1 || (i % every === 0 && data.length - 1 - i >= every)
  const total = series.map((s) => ({
    ...s,
    sum: data.reduce((a, p) => a + (p.values[s.key] ?? 0), 0),
  }))
  const summary = `${label}. ${total.map((s) => `${s.label}: ${formatValue(s.sum)} in total`).join(', ')}.`

  return (
    <figure
      ref={container}
      data-slot="trend-chart"
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-sm text-fg-secondary">
              <span aria-hidden="true" className={cn('size-2.5 rounded-sm', SWATCH[s.tone])} />
              {s.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="text-sm font-medium text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          aria-expanded={table}
          aria-controls={`${id}-table`}
          onClick={() => setTable((t) => !t)}
        >
          {table ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {table ? (
        <div
          id={`${id}-table`}
          className="max-h-80 overflow-auto rounded-md border border-border-subtle"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-surface-muted text-left text-fg-secondary">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {pointHeader}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((p, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-fg">
                    {p.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right tabular-nums text-fg">
                      {formatValue(p.values[s.key] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full overflow-visible"
            role="img"
            aria-label={summary}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(max * f)}
                  y2={y(max * f)}
                  className="stroke-border-subtle"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(max * f)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-fg-muted text-xs"
                >
                  {formatValue(max * f)}
                </text>
              </g>
            ))}
            {data.map((p, i) =>
              labelled(i) ? (
                <text
                  key={i}
                  x={variant === 'line' ? x(i) : bx(i) + band / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-fg-muted text-xs"
                >
                  {p.label}
                </text>
              ) : null,
            )}
            {variant === 'line'
              ? // Drawn in reverse legend order so the first (primary) series stays on top where
                // lines coincide, e.g. a zero Failed line over the baseline.
                [...series]
                  .reverse()
                  .map((s) => (
                    <polyline
                      key={s.key}
                      fill="none"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      className={STROKE[s.tone]}
                      points={data.map((p, i) => `${x(i)},${y(p.values[s.key] ?? 0)}`).join(' ')}
                    />
                  ))
              : data.map((p, i) => {
                  const inner = Math.max(1, band * 0.7)
                  if (variant === 'stacked') {
                    let acc = 0
                    return (
                      <g key={i}>
                        {series.map((s) => {
                          const v = p.values[s.key] ?? 0
                          const top = y(acc + v)
                          const h = y(acc) - top
                          acc += v
                          return h > 0 ? (
                            <rect
                              key={s.key}
                              x={bx(i) + (band - inner) / 2}
                              y={top}
                              width={inner}
                              height={h}
                              className={FILL[s.tone]}
                            />
                          ) : null
                        })}
                      </g>
                    )
                  }
                  const each = inner / series.length
                  return (
                    <g key={i}>
                      {series.map((s, k) => {
                        const v = p.values[s.key] ?? 0
                        return v > 0 ? (
                          <rect
                            key={s.key}
                            x={bx(i) + (band - inner) / 2 + k * each}
                            y={y(v)}
                            width={Math.max(1, each - 1)}
                            height={y(0) - y(v)}
                            className={FILL[s.tone]}
                          />
                        ) : null
                      })}
                    </g>
                  )
                })}
            {active !== null ? (
              <line
                x1={variant === 'line' ? x(active) : bx(active) + band / 2}
                x2={variant === 'line' ? x(active) : bx(active) + band / 2}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-border-control"
                strokeDasharray="3 3"
              />
            ) : null}
            {/* Hover targets: one column per point. */}
            {data.map((p, i) => (
              <rect
                key={i}
                x={variant === 'line' ? x(i) - band / 2 : bx(i)}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </svg>
          {active !== null && data[active] ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 right-0 rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm shadow-raised"
            >
              <p className="font-medium text-fg">{data[active].label}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 text-fg-secondary">
                  <span aria-hidden="true" className={cn('size-2 rounded-sm', SWATCH[s.tone])} />
                  {s.label}: {formatValue(data[active]!.values[s.key] ?? 0)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </figure>
  )
}
