'use client'

import { type ContactEligibility, type EligibilityVerdict } from '@fenwira/contracts'
import { cn, Skeleton, StatusBadge } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useNow } from '@/lib/inbox'

const ROWS: Array<{
  key: keyof Omit<ContactEligibility, 'serviceWindowExpiresAt'>
  label: string
}> = [
  { key: 'freeform', label: 'Free-form replies' },
  { key: 'utilityTemplate', label: 'Utility templates' },
  { key: 'marketingTemplate', label: 'Marketing templates' },
]

export function useEligibility(contactId: string, conversationId?: string) {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(
      tenantId,
      'contacts',
      contactId,
      'eligibility',
      conversationId ?? 'latest',
    ),
    queryFn: () =>
      get<{ data: ContactEligibility }>(
        `/contacts/${contactId}/eligibility${conversationId ? `?conversationId=${conversationId}` : ''}`,
      ).then((r) => r.data),
    enabled: can('contacts.read'),
    refetchInterval: 60_000,
  })
}

function windowText(expiresAt: string | null, now: number): string {
  if (!expiresAt) return 'No 24-hour window: the customer hasn’t written yet.'
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return '24-hour window closed. Send an approved template to reopen the conversation.'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `24-hour window open for ${h ? `${h}h ` : ''}${m}m.`
}

/**
 * What can be sent to this contact now, as decided by MessageEligibilityService (the API computes
 * it; the browser never re-implements consent rules). Explains every restriction in words.
 */
export function EligibilitySummary({
  contactId,
  conversationId,
  className,
}: {
  contactId: string
  conversationId?: string
  className?: string
}) {
  const q = useEligibility(contactId, conversationId)
  const now = useNow(30_000)
  if (q.isPending) return <Skeleton className="h-24 w-full" />
  if (!q.data) return null
  const e = q.data
  return (
    <section aria-label="Messaging eligibility" className={cn('flex flex-col gap-2', className)}>
      <p className="text-sm text-secondary">{windowText(e.serviceWindowExpiresAt, now)}</p>
      <ul className="flex flex-col gap-2">
        {ROWS.map(({ key, label }) => {
          const v: EligibilityVerdict = e[key]
          return (
            <li key={key} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate">{label}</span>
                <StatusBadge status={v.allowed ? 'CAN_SEND' : 'CANNOT_SEND'} />
              </div>
              {!v.allowed && v.reason ? <p className="text-xs text-secondary">{v.reason}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
