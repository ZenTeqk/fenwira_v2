'use client'

import { Button, StatusBadge, Tooltip } from '@fenwira/ui'
import { type Workspace } from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { type ReplyWindow } from '@/lib/reply-window'
import { INDIA_TIMEZONE } from '@/lib/locale'

const expiryDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso))

export function ReplyWindowIndicator({
  window,
  checking,
}: {
  window: ReplyWindow
  checking: boolean
}) {
  const { tenantId, can } = useSession()
  const workspace = useQuery({
    queryKey: keys.tenant(tenantId, 'workspace'),
    queryFn: () => get<{ data: Workspace }>('/workspace').then((result) => result.data),
    enabled: can('workspace.read'),
  })
  if (checking || window.kind === 'checking')
    return <span className="ml-auto text-xs text-fg-secondary">Checking eligibility…</span>
  if (window.kind !== 'open') return null
  const description = `Free-form replies available until ${expiryDate(window.expiresAt, workspace.data?.timezone ?? INDIA_TIMEZONE)}.`
  return (
    <Tooltip content={description}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${window.label}. ${description}`}
        className="ml-auto h-7 shrink-0 px-1 text-xs"
      >
        <StatusBadge
          status={window.phase === 'normal' ? 'WINDOW_OPEN' : 'EXPIRING'}
          appearance={window.phase === 'imminent' ? 'default' : 'inline'}
          label={window.label}
          className={window.phase === 'normal' ? 'text-fg-secondary' : undefined}
        />
      </Button>
    </Tooltip>
  )
}
