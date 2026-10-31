'use client'

import { type WhatsAppConnection, type WorkspaceStatus } from '@fenwira/contracts'
import { type ConnectionStatus, STATUS_PRESETS } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/**
 * Workspace-wide status shown in the shell and on the dashboard (UX_PATTERNS → Application shell).
 * Same query keys as the pages that own the data, so they share one cache entry.
 */
export function useConnections() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'whatsapp-connections'),
    queryFn: () => get<{ data: WhatsAppConnection[] }>('/whatsapp/connections').then((r) => r.data),
    enabled: can('whatsapp.read'),
    staleTime: 60_000,
  })
}

/**
 * Wallet state and (with billing.read) available funds for the shell and dashboard. The state is
 * the billing domain's (decision P11-D12): the UI renders it and never compares amounts itself.
 */
export function useWorkspaceStatus() {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'workspace-status'),
    queryFn: () => get<{ data: WorkspaceStatus }>('/workspace/status').then((r) => r.data),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  })
}

/** The worst state across live numbers; NONE when nothing is connected. */
export function connectionSummary(list: WhatsAppConnection[] | undefined): {
  status: ConnectionStatus
  name?: string
  count: number
} {
  const live = (list ?? []).filter((c) => c.status !== 'PENDING')
  if (!live.length) return { status: 'NONE', count: 0 }
  const order: ConnectionStatus[] = ['ERROR', 'DISCONNECTED', 'RESTRICTED', 'FLAGGED', 'CONNECTED']
  const worst = order.find((s) => live.some((c) => c.status === s)) ?? 'CONNECTED'
  const first = live.find((c) => c.status === worst) ?? live[0]!
  return {
    status: worst,
    name: live.length === 1 ? first.displayPhoneNumber : `${live.length} numbers`,
    count: live.length,
  }
}

export type ConnectionHealth =
  'connected' | 'disconnected' | 'attention' | 'checking' | 'unavailable'

/** Numbers that can't send (red), need a look (amber) or are fine (green). */
const BROKEN = new Set(['ERROR', 'DISCONNECTED', 'RESTRICTED'])
const ATTENTION = new Set(['FLAGGED', 'PENDING'])

/**
 * One aggregate across every number. Missing, still-loading or failed-to-load data is never
 * "connected": a failed refresh over older cached data reads "Status unavailable".
 */
export function connectionHealth(
  list: WhatsAppConnection[] | undefined,
  pending: boolean,
  failed: boolean,
): { health: ConnectionHealth; label: string } {
  if (failed) return { health: 'unavailable', label: 'Status unavailable' }
  if (!list) return pending ? { health: 'checking', label: 'Checking…' } : unavailable()
  if (!list.length) return { health: 'disconnected', label: 'Not connected' }
  const broken = list.filter((n) => BROKEN.has(n.status))
  const attention = list.filter((n) => ATTENTION.has(n.status))
  const one = list.length === 1
  if (broken.length)
    return {
      health: 'disconnected',
      label: one
        ? STATUS_PRESETS[broken[0]!.status].label
        : `${broken.length} of ${list.length} numbers not connected`,
    }
  if (attention.length)
    return {
      health: 'attention',
      label: one
        ? attention[0]!.status === 'PENDING'
          ? 'Setup pending'
          : 'Needs attention'
        : `${attention.length} of ${list.length} numbers need attention`,
    }
  return { health: 'connected', label: one ? 'Connected' : `${list.length} numbers connected` }
}
const unavailable = () => ({ health: 'unavailable' as const, label: 'Status unavailable' })

export { formatMoney } from '@/lib/billing'
