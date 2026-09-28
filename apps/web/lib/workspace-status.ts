'use client'

import { type Wallet, type WhatsAppConnection } from '@fenwira/contracts'
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

export function useWallet() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'wallet'),
    queryFn: () => get<{ data: Wallet }>('/billing/wallet').then((r) => r.data),
    enabled: can('billing.read'),
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

/**
 * TEMPORARY development default (decision P11-D1): low balance is a billing-domain state. Phase 11
 * returns the wallet state from the backend (`billing.low_balance_threshold`) and this constant and
 * `walletState` are removed; production must never rely on a frontend threshold.
 */
export const LOW_BALANCE_MINOR = 10_000

export function walletState(w: Wallet | undefined): 'HIDDEN' | 'EMPTY' | 'LOW' | 'OK' {
  if (!w || !w.enforced) return 'HIDDEN'
  if (w.availableMinor <= 0) return 'EMPTY'
  if (w.availableMinor <= LOW_BALANCE_MINOR) return 'LOW'
  return 'OK'
}

export { money as formatMoney } from '@/lib/campaigns'
