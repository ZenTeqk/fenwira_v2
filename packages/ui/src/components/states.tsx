import { AlertOctagon, Inbox } from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './button'

export type EmptyStateProps = {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-fg-subtle [&_svg]:size-6">
        {icon ?? <Inbox aria-hidden="true" />}
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-semibold text-fg">{title}</p>
        {description ? <p className="text-base text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export type ErrorStateProps = {
  title?: string
  description?: ReactNode
  /** Shown so support can find the request in the logs (docs/OBSERVABILITY.md). */
  correlationId?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this content. Please try again.',
  correlationId,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-status-error-bg text-status-error-fg [&_svg]:size-6">
        <AlertOctagon aria-hidden="true" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-semibold text-fg">{title}</p>
        <p className="text-base text-fg-muted">{description}</p>
        {correlationId ? (
          <p className="text-sm text-fg-muted">
            Reference: <span className="font-mono">{correlationId}</span>
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
