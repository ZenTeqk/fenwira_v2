'use client'

import {
  Button,
  cn,
  focusRing,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusBadge,
  textLink,
  Tooltip,
} from '@fenwira/ui'
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from 'lucide-react'
import Link from 'next/link'
import {
  type ConnectionHealth as Health,
  connectionHealth,
  useConnections,
} from '@/lib/workspace-status'
import { useSession } from '../session/session-provider'

/** Status icon: shape and colour together (never colour alone), with the label beside or in it. */
const ICON: Record<Health, { icon: typeof CheckCircle2; className: string }> = {
  connected: { icon: CheckCircle2, className: 'text-status-success' },
  disconnected: { icon: XCircle, className: 'text-status-error' },
  attention: { icon: AlertTriangle, className: 'text-status-warning' },
  checking: { icon: Loader2, className: 'animate-spin text-fg-subtle motion-reduce:animate-none' },
  unavailable: { icon: CircleHelp, className: 'text-fg-subtle' },
}
/** Status dot (solid status tokens; non-text 3:1 on the surface in both themes). */
const DOT: Record<Health, string> = {
  connected: 'bg-status-success',
  disconnected: 'bg-status-error',
  attention: 'bg-status-warning',
  checking: 'bg-status-neutral',
  unavailable: 'bg-status-neutral',
}
/** The short visible label; the accessible name carries the exact aggregate. */
export const SHORT_LABEL: Record<Health, string> = {
  connected: 'WhatsApp',
  disconnected: 'Disconnected',
  attention: 'Needs attention',
  checking: 'Checking…',
  unavailable: 'Status unavailable',
}
const SHORT = SHORT_LABEL

/**
 * Header WhatsApp indicator (shares the integrations connections query; no new polling): one
 * neutral control with a status dot and short label. Healthy has the tooltip "WhatsApp
 * connected". A click opens the number details with a link to the existing WhatsApp page.
 */
export function WhatsAppConnectionControl() {
  const { can } = useSession()
  const connections = useConnections()
  if (!can('whatsapp.read')) return null

  const list = connections.data
  const { health, label } = connectionHealth(list, connections.isPending, connections.isError)
  const { icon: Icon, className: iconClass } = ICON[health]

  const trigger = (
    <PopoverTrigger
      aria-label={`WhatsApp: ${label.replace(/…$/, '')}. Show connection details`}
      aria-busy={health === 'checking'}
      data-health={health}
      className={cn(
        // One neutral control: a status dot and a short label from `sm`; on phones a small shape
        // icon (never colour alone). The exact status is in the accessible name and the details.
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border-subtle bg-surface px-2 text-sm font-medium text-fg hover:bg-surface-hover sm:px-3',
        focusRing,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'hidden size-2 shrink-0 rounded-full sm:block',
          DOT[health],
          health === 'checking' && 'motion-safe:animate-pulse',
        )}
      />
      <Icon className={cn('size-4 shrink-0 sm:hidden', iconClass)} aria-hidden="true" />
      <span className="hidden max-w-40 truncate sm:inline">{SHORT[health]}</span>
    </PopoverTrigger>
  )

  return (
    <Popover>
      {health === 'connected' ? (
        <Tooltip content="WhatsApp connected" side="bottom">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent align="start" className="flex w-80 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Icon className={cn('size-4 shrink-0', iconClass)} aria-hidden="true" />
          <h2 className="text-base font-semibold text-fg">WhatsApp · {label}</h2>
        </div>
        {list?.length && !connections.isError ? (
          <ul aria-label="WhatsApp numbers" className="flex flex-col gap-2">
            {list.map((number) => (
              <li
                key={number.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-fg">
                    {number.displayPhoneNumber}
                  </span>
                  {number.label || number.verifiedName ? (
                    <span className="truncate text-xs text-fg-secondary">
                      {number.label ?? number.verifiedName}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1">
                  <StatusBadge status={number.status} />
                  {number.status === 'CONNECTED' ? (
                    <StatusBadge status={number.qualityRating} />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-secondary">
            {health === 'checking'
              ? 'Checking your WhatsApp numbers…'
              : health === 'unavailable'
                ? 'We couldn’t load the connection status. Nothing is assumed connected.'
                : 'No WhatsApp number is connected to this workspace yet.'}
          </p>
        )}
        {health === 'unavailable' ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => void connections.refetch()}
          >
            Try again
          </Button>
        ) : null}
        <p className="text-xs text-fg-secondary">
          Shows the latest status Meta reported for each number. It doesn’t guarantee that every
          message is delivered.
        </p>
        <Link href="/integrations/whatsapp" className={cn('self-start text-sm', textLink)}>
          View connection
        </Link>
      </PopoverContent>
    </Popover>
  )
}
