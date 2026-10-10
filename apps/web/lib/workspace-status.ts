'use client'

import { type WhatsAppConnection, type WorkspaceStatus } from '@fenwira/contracts'
import { type ConnectionStatus } from '@fenwira/ui'
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

export { formatMoney } from '@/lib/billing'
