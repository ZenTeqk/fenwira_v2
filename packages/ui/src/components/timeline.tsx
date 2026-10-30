import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { STATUS_PRESETS, StatusBadge, type StatusKey } from './status-badge'

export type TimelineItem = {
  id: string
  title: ReactNode
  /** Rendered as a StatusBadge (label + icon), never color alone. */
  status?: StatusKey
  icon?: ReactNode
  time?: ReactNode
  description?: ReactNode
  /** Collapsible extra detail (payloads, raw values). */
  details?: ReactNode
}

const activityTones = {
  success: 'bg-action-primary-subtle text-action-primary',
  info: 'bg-status-info-bg text-status-info-fg',
  warning: 'bg-status-warning-bg text-status-warning-fg',
  danger: 'bg-status-error-bg text-status-error-fg',
  neutral: 'bg-surface-muted text-fg-secondary',
} as const
const activityTone = (status?: StatusKey) =>
  activityTones[status ? STATUS_PRESETS[status].tone : 'neutral']

/** Ordered event list (automation steps, contact activity, audit trail). */
export function Timeline({
  items,
  label,
  empty,
  className,
  appearance = 'default',
}: {
  items: TimelineItem[]
  label: string
  empty?: ReactNode
  className?: string
  /** Opt-in richer communication activity treatment; audit/other timelines retain defaults. */
  appearance?: 'default' | 'activity'
}) {
  if (!items.length) return <p className="text-sm text-fg-muted">{empty ?? 'Nothing yet.'}</p>
  return (
    <ol data-slot="timeline" aria-label={label} className={cn('flex flex-col', className)}>
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute bottom-0 w-px bg-border-subtle',
                appearance === 'activity' ? 'top-9 left-4.5' : 'top-7 left-3.5',
              )}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              'relative flex shrink-0 items-center justify-center rounded-full [&_svg]:size-4',
              appearance === 'activity'
                ? cn('size-9', activityTone(item.status))
                : 'size-7 border border-border-subtle bg-surface text-fg-secondary',
            )}
          >
            {item.icon ?? (
              <span
                className={cn(
                  'size-2 rounded-full',
                  appearance === 'activity' ? 'bg-current' : 'bg-fg-subtle',
                )}
              />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-fg">{item.title}</p>
              {item.status ? <StatusBadge status={item.status} /> : null}
              {item.time ? <span className="text-xs text-fg-muted">{item.time}</span> : null}
            </div>
            {item.description ? (
              <div className="text-sm text-fg-secondary">{item.description}</div>
            ) : null}
            {item.details ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-fg-secondary">Details</summary>
                <div className="mt-2">{item.details}</div>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
