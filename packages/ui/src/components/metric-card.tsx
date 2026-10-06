import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Card } from './card'
import { Skeleton } from './skeleton'

export type MetricDelta = {
  /** Pre-formatted, e.g. "+4.2%" */
  value: string
  direction: 'up' | 'down' | 'flat'
  /** Whether this direction is good news; decides the icon tone. The sign/arrow carries meaning too. */
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
  className?: string
}

const deltaIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }
const sentimentTone = {
  positive: 'text-primary-strong',
  negative: 'text-danger-strong',
  neutral: 'text-muted',
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
  className,
}: MetricCardProps) {
  const DeltaIcon = delta ? deltaIcon[delta.direction] : null
  return (
    <Card
      data-slot="metric-card"
      className={cn('flex flex-col gap-3 p-5', compact && 'gap-1 border-0 p-3', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-secondary">{label}</p>
        {icon ? (
          <span className="text-muted [&_svg]:size-4" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className={cn('text-2xl font-semibold text-slate tabular-nums', compact && 'text-xl')}>
          {value}
        </p>
      )}
      {delta && DeltaIcon && !loading ? (
        <p className="flex items-center gap-1 text-sm text-muted">
          <DeltaIcon
            className={cn('size-4', sentimentTone[delta.sentiment ?? 'neutral'])}
            aria-hidden="true"
          />
          <span className="font-medium text-slate">{delta.value}</span>
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
