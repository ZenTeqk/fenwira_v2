'use client'

import {
  type FollowUpSummary,
  type Member,
  type Opportunity,
  type Permission,
  type Role,
  roleHasPermission,
  type SalesStage,
  type Workspace,
} from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useRealtimeEvent } from '@/lib/realtime'

export {
  formatDue,
  formatMoney,
  fractionDigits,
  moneyInput,
  parseMoney,
  quickDue,
  toUtcIso,
  waitedFor,
  zonedParts,
} from './follow-up-format'

/**
 * Follow-ups and sales in the browser (docs/FOLLOW_UPS_AND_SALES.md). Due times are stored in
 * UTC and shown and entered in the workspace timezone, never the browser's.
 */

/** Follow-ups, sales and response alerts are on for this workspace (rollout switch). */
export function useSalesOn(): boolean {
  return useSession().membership.salesFollowups
}

export function useWorkspaceTimezone(): string {
  const { tenantId, can } = useSession()
  const workspace = useQuery({
    queryKey: keys.tenant(tenantId, 'workspace'),
    queryFn: () => get<{ data: Workspace }>('/workspace').then((r) => r.data),
    enabled: can('workspace.read'),
    staleTime: 5 * 60_000,
  })
  return workspace.data?.timezone ?? 'Asia/Kolkata'
}

// ------------------------------------------------------------------------------- queries

export function useFollowUpSummary() {
  const { tenantId, can } = useSession()
  const on = useSalesOn()
  const summary = useQuery({
    queryKey: keys.tenant(tenantId, 'follow-ups', 'summary'),
    queryFn: () => get<{ data: FollowUpSummary }>('/follow-ups/summary').then((r) => r.data),
    enabled: on && can('followups.read'),
    refetchInterval: 60_000,
  })
  useRealtimeEvent('follow_up.changed', () => void summary.refetch())
  useRealtimeEvent('notification.created', () => void summary.refetch())
  return summary
}

/** Active teammates whose role holds `permission` (assignees, sales owners). */
export function useMembers(permission: Permission) {
  const { tenantId, can } = useSession()
  const members = useQuery({
    queryKey: keys.tenant(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: can('team.read'),
    staleTime: 60_000,
  })
  return {
    ...members,
    data: (members.data ?? []).filter(
      (m) => m.status === 'ACTIVE' && roleHasPermission(m.role as Role, permission),
    ),
  }
}

export function useSalesStages() {
  const { tenantId, can } = useSession()
  const on = useSalesOn()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'sales', 'stages'),
    queryFn: () => get<{ data: SalesStage[] }>('/sales/stages').then((r) => r.data),
    enabled: on && can('sales.read'),
    staleTime: 60_000,
  })
}

/** The contact's opportunities, newest first (the open one, if any, plus history). */
export function useContactOpportunities(contactId: string | undefined) {
  const { tenantId, can } = useSession()
  const on = useSalesOn()
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'sales', 'opportunities', contactId ?? ''),
    queryFn: () =>
      get<{ data: Opportunity[] }>(`/opportunities?contactId=${contactId}&limit=20`).then(
        (r) => r.data,
      ),
    enabled: on && !!contactId && can('sales.read'),
  })
  useRealtimeEvent<{ contactId?: string }>('sales.updated', (e) => {
    if (e.contactId === contactId) void q.refetch()
  })
  return q
}
