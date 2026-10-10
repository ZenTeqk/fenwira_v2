import { type Conversation, type Role, roleHasPermission } from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { AppError } from '../../core/http/app-error'
import { writeSystemEvent } from '../messaging'
import { createNotification, type NewNotification } from '../notifications'

export const CONVERSATION_INCLUDE = (userId: string) =>
  ({
    contact: true,
    phoneNumber: { select: { id: true, displayPhoneNumber: true } },
    assignee: { select: { id: true, name: true } },
    tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
    readStates: { where: { userId }, select: { unreadCount: true } },
  }) satisfies Prisma.ConversationInclude

type Row = Prisma.ConversationGetPayload<{ include: ReturnType<typeof CONVERSATION_INCLUDE> }>
const iso = (d: Date | null) => d?.toISOString() ?? null

export function toConversation(c: Row, snippet?: string | null): Conversation {
  const expires = c.serviceWindowExpiresAt
  return {
    id: c.id,
    status: c.status,
    contact: {
      id: c.contact.id,
      phoneE164: c.contact.phoneE164,
      name: c.contact.name,
      waProfileName: c.contact.waProfileName,
    },
    phoneNumber: c.phoneNumber,
    assignee: c.assignee,
    tags: c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    automationState: c.automationState,
    // No read-state row yet: the user has never opened it, so every inbound message is unread.
    unreadCount: c.readStates[0]?.unreadCount ?? c.inboundCount,
    lastMessageAt: iso(c.lastMessageAt),
    lastMessagePreview: c.lastMessagePreview,
    lastCustomerMessageAt: iso(c.lastCustomerMessageAt),
    serviceWindowExpiresAt: iso(expires),
    serviceWindow: { expiresAt: iso(expires), isOpen: !!expires && expires > new Date() },
    snoozedUntil: iso(c.snoozedUntil),
    firstResponseAt: iso(c.firstResponseAt),
    ...(snippet !== undefined ? { snippet } : {}),
    createdAt: c.createdAt.toISOString(),
  }
}

export type Assignment = {
  tenantId: string
  conversation: { id: string; contactId: string; assigneeId: string | null; inboundCount: number }
  assigneeId: string | null
  actor: { id: string | null; name: string | null }
}

/**
 * Assign or unassign (docs/INBOX.md → Assignment): checks the target is an active member who can
 * reply, writes the system event, the assignee's read state and notification, and the outbox event.
 * Permission checks for the actor happen in the caller. Returns the notification to push.
 */
export async function assignConversation(tx: TenantTx, a: Assignment) {
  const previous = a.conversation.assigneeId
  if (previous === a.assigneeId) return null
  let assigneeName: string | null = null
  if (a.assigneeId) {
    const member = await tx.membership.findFirst({
      where: { userId: a.assigneeId, status: 'ACTIVE' },
      include: { user: { select: { name: true } } },
    })
    if (!member || !roleHasPermission(member.role as Role, 'inbox.reply'))
      throw AppError.validation([
        {
          path: 'assigneeId',
          code: 'not_agent',
          message: 'Assign to a team member who can reply.',
        },
      ])
    assigneeName = member.user.name
  }
  const now = new Date()
  await tx.conversation.update({
    where: { id: a.conversation.id },
    data: { assigneeId: a.assigneeId, assignedAt: a.assigneeId ? now : null },
  })
  if (a.assigneeId)
    await tx.$executeRaw`
      INSERT INTO conversation_read_states (tenant_id, conversation_id, user_id, unread_count, updated_at)
      VALUES (${a.tenantId}::uuid, ${a.conversation.id}::uuid, ${a.assigneeId}::uuid, ${a.conversation.inboundCount}, now())
      ON CONFLICT (conversation_id, user_id) DO NOTHING`
  await writeSystemEvent(
    tx,
    {
      tenantId: a.tenantId,
      conversationId: a.conversation.id,
      contactId: a.conversation.contactId,
    },
    a.assigneeId ? 'assigned' : 'unassigned',
    {
      actorId: a.actor.id,
      actorName: a.actor.name,
      from: previous,
      to: a.assigneeId,
      toName: assigneeName,
    },
  )
  await tx.outboxEvent.create({
    data: {
      tenantId: a.tenantId,
      eventType: 'conversation.assigned',
      aggregateType: 'conversation',
      aggregateId: a.conversation.id,
      payload: {
        conversationId: a.conversation.id,
        assigneeId: a.assigneeId,
        previousAssigneeId: previous,
      },
    },
  })
  if (!a.assigneeId || a.assigneeId === a.actor.id) return null
  const n: NewNotification = {
    tenantId: a.tenantId,
    userId: a.assigneeId,
    type: 'conversation.assigned',
    title: 'Conversation assigned to you',
    body: a.actor.name
      ? `${a.actor.name} assigned you a conversation.`
      : 'A conversation was assigned to you.',
    link: `/inbox?c=${a.conversation.id}`,
  }
  return { userId: a.assigneeId, notification: await createNotification(tx, n) }
}

/** Full-text + name/phone search: conversation ids with the newest matching message text. */
export async function searchConversations(
  tx: TenantTx,
  q: string,
): Promise<Map<string, string | null>> {
  const byMessage = await tx.$queryRaw<Array<{ conversation_id: string; text: string | null }>>`
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id,
           coalesce(m.content->>'text', m.content->>'caption') AS text
    FROM messages m
    WHERE m.text_search @@ plainto_tsquery('simple', ${q})
    ORDER BY m.conversation_id, m.created_at DESC
    LIMIT 500`
  const digits = q.replace(/\D/g, '')
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const byContact = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE ct.name ILIKE ${like} OR ct.wa_profile_name ILIKE ${like}
       OR (${digits.length >= 3} AND ct.phone_e164 LIKE ${`+${digits}%`})
       OR (${digits.length >= 3} AND ct.phone_e164 LIKE ${`%${digits}%`})
    LIMIT 500`
  const out = new Map<string, string | null>()
  for (const r of byMessage) out.set(r.conversation_id, r.text)
  for (const r of byContact) if (!out.has(r.id)) out.set(r.id, null)
  return out
}
