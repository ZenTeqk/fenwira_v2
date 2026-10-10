'use client'

import { type EntitlementStatus, type Plan, type Subscription } from '@fenwira/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Plans, subscription and entitlements (Phase 11 Step 4, docs/BILLING.md → Plans). */

export function useSubscription() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'subscription'),
    queryFn: () => get<{ data: Subscription }>('/billing/subscription').then((r) => r.data),
    enabled: can('billing.read'),
  })
}

export function usePlans() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'plans'),
    queryFn: () => get<{ data: Plan[] }>('/billing/plans').then((r) => r.data),
    enabled: can('billing.read'),
    staleTime: 5 * 60_000,
  })
}

/** Every role (workspace.read): limits explain a LIMIT_EXCEEDED anywhere in the app. */
export function useEntitlements() {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'entitlements'),
    queryFn: () => get<{ data: EntitlementStatus[] }>('/billing/entitlements').then((r) => r.data),
    enabled: Boolean(tenantId),
  })
}

export function useRequestPlan() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) =>
      post<{ data: Subscription }>('/billing/subscription/request', { planId }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'subscription') })
    },
  })
}

export const STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  EXPIRED: 'Trial ended',
  CANCELLED: 'Ended',
}
