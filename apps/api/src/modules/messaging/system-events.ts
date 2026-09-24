import { type Prisma, type TenantTx } from '@fenwira/database'

/**
 * Conversation events (assigned, resolved, takeover, …) are stored as SYSTEM messages
 * (docs/INBOX.md → Conversation model) so they appear in the thread as neutral pills.
 */
export type SystemEvent =
  | 'assigned'
  | 'unassigned'
  | 'status_changed'
  | 'takeover'
  | 'automation_resumed'
  | 'automation_paused'
  | 'reopened'

export async function writeSystemEvent(
  tx: TenantTx,
  c: { tenantId: string; conversationId: string; contactId: string },
  event: SystemEvent,
  data: {
    actorId?: string | null
    actorName?: string | null
    from?: string | null
    to?: string | null
    [k: string]: unknown
  },
) {
  return tx.message.create({
    data: {
      tenantId: c.tenantId,
      conversationId: c.conversationId,
      contactId: c.contactId,
      direction: 'SYSTEM',
      type: 'SYSTEM_EVENT',
      status: 'RECEIVED',
      source: 'SYSTEM',
      content: { type: 'SYSTEM_EVENT', event, data } as Prisma.InputJsonValue,
    },
  })
}
