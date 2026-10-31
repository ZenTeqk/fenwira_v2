'use client'

import { cn, focusRing, StatusBadge, STATUS_PRESETS, Tooltip } from '@fenwira/ui'
import { MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { connectionSummary, useConnections } from '@/lib/workspace-status'
import { useSession } from '../session/session-provider'

/** Uses the integrations cache, including its existing worst-state summary across live numbers. */
export function WhatsAppConnectionControl() {
  const { can } = useSession()
  const connections = useConnections()
  if (!can('whatsapp.read')) return null

  const summary = connectionSummary(connections.data)
  const status = connections.data
    ? summary.status === 'NONE'
      ? connections.data.some((number) => number.status === 'PENDING')
        ? 'PENDING'
        : 'DISCONNECTED'
      : summary.status
    : connections.isPending
      ? 'SYNCING'
      : 'UNKNOWN'
  const label =
    connections.data?.length === 0
      ? 'Not connected'
      : status === 'SYNCING'
        ? 'Loading'
        : status === 'UNKNOWN'
          ? 'Status unavailable'
          : STATUS_PRESETS[status].label
  const description = `WhatsApp: ${label}${summary.count > 1 ? ` · ${summary.count} numbers` : ''}`
  const details = connections.data?.length
    ? connections.data
        .map((number) => `${number.displayPhoneNumber}: ${STATUS_PRESETS[number.status].label}`)
        .join('; ')
    : description

  return (
    <Tooltip content={details} side="bottom">
      <Link
        href="/integrations/whatsapp"
        aria-label={`${description}. View connections`}
        aria-busy={connections.isPending}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1 rounded-sm px-1 text-sm text-fg-secondary hover:bg-surface-hover sm:px-2',
          focusRing,
        )}
      >
        {status === 'CONNECTED' ? (
          <>
            <MessageCircle className="size-4" aria-hidden="true" />
            {summary.count > 1 ? <span>{summary.count}</span> : null}
          </>
        ) : (
          <StatusBadge status={status} label={status === 'UNKNOWN' ? 'Unavailable' : label} />
        )}
      </Link>
    </Tooltip>
  )
}
