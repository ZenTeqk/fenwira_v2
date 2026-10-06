'use client'

import { useId, useMemo, useState } from 'react'
import { cn } from '../lib/cn'

/**
 * Series colors for charts. Each meets the 3:1 non-text contrast of WCAG 1.4.11 against the
 * surface; values are never carried by color alone (legend text, table alternative, focus
 * values). docs/design/FENWIRA_DESIGN_SYSTEM.md → Charts.
 */
export type ChartTone = 'primary' | 'info' | 'success' | 'danger' | 'warning' | 'neutral'
const FILL: Record<ChartTone, string> = {
  primary: 'fill-primary-strong',
  info: 'fill-info',
  success: 'fill-success-strong',
  danger: 'fill-danger',
  warning: 'fill-warning-strong',
  neutral: 'fill-secondary',
}
const STROKE: Record<ChartTone, string> = {
  primary: 'stroke-primary-strong',
  info: 'stroke-info',
  success: 'stroke-success-strong',
  danger: 'stroke-danger',
  warning: 'stroke-warning-strong',
  neutral: 'stroke-secondary',
}
const SWATCH: Record<ChartTone, string> = {
  primary: 'bg-primary-strong',
  info: 'bg-info',
  success: 'bg-success-strong',
  danger: 'bg-danger',
  warning: 'bg-warning-strong',
  neutral: 'bg-secondary',
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

const W = 640
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
  const every = Math.max(1, Math.ceil(data.length / 8))
  const total = series.map((s) => ({
    ...s,
    sum: data.reduce((a, p) => a + (p.values[s.key] ?? 0), 0),
  }))
  const summary = `${label}. ${total.map((s) => `${s.label}: ${formatValue(s.sum)} in total`).join(', ')}.`

  return (
    <figure data-slot="trend-chart" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-sm text-secondary">
              <span aria-hidden="true" className={cn('size-2.5 rounded-sm', SWATCH[s.tone])} />
              {s.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="text-sm font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
          aria-expanded={table}
          aria-controls={`${id}-table`}
          onClick={() => setTable((t) => !t)}
        >
          {table ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {table ? (
        <div id={`${id}-table`} className="max-h-80 overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-neutral-soft text-left text-secondary">
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
                <tr key={i} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-slate">
                    {p.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right tabular-nums text-slate">
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
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(max * f)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted text-xs"
                >
                  {formatValue(max * f)}
                </text>
              </g>
            ))}
            {data.map((p, i) =>
              i % every === 0 || i === data.length - 1 ? (
                <text
                  key={i}
                  x={variant === 'line' ? x(i) : bx(i) + band / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted text-xs"
                >
                  {p.label}
                </text>
              ) : null,
            )}
            {variant === 'line'
              ? series.map((s) => (
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
                className="stroke-border-strong"
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
              className="pointer-events-none absolute top-0 right-0 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-raised"
            >
              <p className="font-medium text-slate">{data[active].label}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 text-secondary">
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
