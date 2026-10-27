'use client'

import { type AutomationState, type Conversation, type Presence } from '@fenwira/contracts'
import { toast } from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, post, put } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

export const STATUS_LABEL: Record<Conversation['status'], string> = {
  OPEN: 'Open',
  PENDING: 'Waiting on customer',
  SNOOZED: 'Snoozed',
  RESOLVED: 'Resolved',
}

export function snoozeTimes() {
  const inHour = new Date(Date.now() + 3600_000)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const nextWeek = new Date(tomorrow)
  nextWeek.setDate(nextWeek.getDate() + 6)
  return [
    { label: '1 hour', at: inHour },
    { label: 'Tomorrow 9:00', at: tomorrow },
    { label: 'Next week', at: nextWeek },
  ]
}

export function usePresence() {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'inbox', 'presence'),
    queryFn: () => get<{ data: Presence[] }>('/inbox/presence').then((r) => r.data),
    staleTime: 15_000,
  })
}

/**
 * The conversation's workflow actions (assign, status, automation, tags) through the existing
 * endpoints, which check permissions and record the audit trail. The header, status bar and
 * contact details all use this, and all read the same conversation query, so they never disagree.
 */
export function useConversationActions(c: Conversation) {
  const { tenantId, can, me } = useSession()
  const queryClient = useQueryClient()
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Something went wrong.'),
  })
  const base = `/conversations/${c.id}`
  const mine = c.assignee?.id === me.user.id
  return {
    pending: act.isPending,
    can: {
      assignSelf: can('inbox.assign_self') && !mine,
      unassign: !!c.assignee && can('inbox.assign_self') && (mine || can('inbox.reassign')),
      reassign: can('inbox.reassign'),
      /** Status, automation and tags share the reply permission their endpoints require. */
      reply: can('inbox.reply'),
    },
    assign: (assigneeId: string | null) => act.mutate(() => post(`${base}/assign`, { assigneeId })),
    assignToMe: () => act.mutate(() => post(`${base}/assign`, { assigneeId: me.user.id })),
    setStatus: (status: Conversation['status'], snoozedUntil?: Date) =>
      act.mutate(() =>
        post(`${base}/status`, {
          status,
          ...(snoozedUntil ? { snoozedUntil: snoozedUntil.toISOString() } : {}),
        }),
      ),
    /** "Resume" is the existing return-to-automation call, unchanged. */
    setAutomation: (state: AutomationState) =>
      act.mutate(() => post(`${base}/automation-state`, { state })),
    toggleTag: (tagId: string, on: boolean) =>
      act.mutate(() => (on ? del(`${base}/tags/${tagId}`) : put(`${base}/tags/${tagId}`, {}))),
  }
}
