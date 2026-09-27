import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { StatusBadge, type StatusKey } from './status-badge'

export type ConnectionStatus =
  'CONNECTED' | 'FLAGGED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR' | 'NONE'

const DOT: Record<ConnectionStatus, string> = {
  CONNECTED: 'bg-success',
  FLAGGED: 'bg-warning',
  RESTRICTED: 'bg-danger',
  DISCONNECTED: 'bg-danger',
  ERROR: 'bg-danger',
  NONE: 'bg-slate-400',
}
const LABEL: Record<ConnectionStatus, string> = {
  CONNECTED: 'Connected',
  FLAGGED: 'Flagged by Meta',
  RESTRICTED: 'Restricted',
  DISCONNECTED: 'Disconnected',
  ERROR: 'Connection error',
  NONE: 'Not connected',
}

export type ConnectionStateProps = {
  status: ConnectionStatus
  /** e.g. the display phone number or the integration name. */
  name?: ReactNode
  detail?: ReactNode
  action?: ReactNode
  /** One-line form for the sidebar footer on the dark navigation. */
  variant?: 'default' | 'compact'
  className?: string
}

/** A channel or integration's connection, with a label (never color alone). */
export function ConnectionState({
  status,
  name,
  detail,
  action,
  variant = 'default',
  className,
}: ConnectionStateProps) {
  if (variant === 'compact')
    return (
      <span
        data-slot="connection-state"
        className={cn('inline-flex min-w-0 items-center gap-2', className)}
      >
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[status])} />
        <span className="truncate">
          {name ? <>{name} · </> : null}
          {LABEL[status]}
        </span>
      </span>
    )
  return (
    <div
      data-slot="connection-state"
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {name ? <p className="truncate font-medium text-slate">{name}</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
          {status === 'NONE' ? (
            <span>{LABEL.NONE}</span>
          ) : (
            <StatusBadge status={status as StatusKey} label={LABEL[status]} />
          )}
          {detail ? <span>{detail}</span> : null}
        </div>
      </div>
      {action}
    </div>
  )
}
