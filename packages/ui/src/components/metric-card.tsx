import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Card } from './card'
import { Skeleton } from './skeleton'
import { StatusBadge, type StatusKey } from './status-badge'

export type MetricDelta = {
  /** Pre-formatted, e.g. "+4.2%" */
  value: string
  direction: 'up' | 'down' | 'flat'
  /**
   * Whether this direction is good news; decides the badge tone. Pass `negative` for an increase
   * in a metric where up is bad (failures, spend). The sign/arrow carries meaning too.
   */
  sentiment?: 'positive' | 'negative' | 'neutral'
  /** e.g. "vs last week" */
  label?: string
}

export type MetricCardProps = {
  label: string
  value: ReactNode
  delta?: MetricDelta
  icon?: ReactNode
  hint?: ReactNode
  loading?: boolean
  /** Compact secondary summary for Home; analytics keeps the standard presentation. */
  compact?: boolean
  /** Joined Analytics metric strip; default cards and Home remain unchanged. */
  appearance?: 'analytics'
  className?: string
}

/** Trends render through StatusBadge: arrow icon for direction, tone for good or bad news. */
const trendStatus = ({ direction, sentiment = 'neutral' }: MetricDelta): StatusKey =>
  direction === 'flat'
    ? 'TREND_FLAT'
    : `TREND_${direction === 'up' ? 'UP' : 'DOWN'}_${sentiment === 'positive' ? 'POSITIVE' : sentiment === 'negative' ? 'NEGATIVE' : 'NEUTRAL'}`

function IconTile({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-strong [&_svg]:size-4"
    >
      {icon}
    </span>
  )
}

/** One key number with its label, optional trend and hint (UX_PATTERNS → Dashboard). */
export function MetricCard({
  label,
  value,
  delta,
  icon,
  hint,
  loading,
  compact,
  appearance,
  className,
}: MetricCardProps) {
  if (appearance === 'analytics')
    return (
      <Card
        data-slot="metric-card"
        className={cn('flex items-start gap-3 rounded-none border-0 bg-transparent p-3', className)}
      >
        {icon ? <IconTile icon={icon} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium text-secondary">{label}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-xl font-semibold text-slate tabular-nums">{value}</p>
            )}
            {delta && !loading ? (
              <StatusBadge status={trendStatus(delta)} label={delta.value} />
            ) : null}
          </div>
          {delta?.label && !loading ? (
            <p className="text-xs text-secondary">{delta.label}</p>
          ) : null}
          {hint ? <div className="text-xs text-secondary">{hint}</div> : null}
        </div>
      </Card>
    )
  return (
    <Card
      data-slot="metric-card"
      className={cn('flex flex-col gap-3 p-5', compact && 'gap-1 border-0 p-3', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-secondary">{label}</p>
        {icon ? <IconTile icon={icon} /> : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className={cn('text-2xl font-semibold text-slate tabular-nums', compact && 'text-xl')}>
          {value}
        </p>
      )}
      {delta && !loading ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <StatusBadge status={trendStatus(delta)} label={delta.value} />
          {delta.label ? <span>{delta.label}</span> : null}
        </p>
      ) : null}
      {/* The hint stays under a delta: it explains the figure (for example a rate's denominator). */}
      {hint ? <div className="text-sm text-secondary">{hint}</div> : null}
    </Card>
  )
}

/** @deprecated Use MetricCard (Design System v1 name). Kept for one release. */
export const KpiCard = MetricCard
export type KpiCardProps = MetricCardProps
export type KpiDelta = MetricDelta
