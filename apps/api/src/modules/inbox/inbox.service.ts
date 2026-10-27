import {
  type AutomationState,
  type Conversation,
  type ConversationNote,
  type ConversationsQuery,
  type ConversationStatus,
  type InboxSettings,
  MEDIA_FILTER_KIND,
  type MediaCounts,
  type Message,
  type Notification,
  type SendableContent,
  type ThreadMediaFilter,
} from '@fenwira/contracts'
import { Database, type Prisma, type TenantTx } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'
import { AppError } from '../../core/http/app-error'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AuditService } from '../audit'
import { currentApiKey, currentAuth } from '../identity'
import {
  MARK_READ_JOB,
  MESSAGE_FILE_SELECT,
  MessagingService,
  toMessage,
  writeSystemEvent,
} from '../messaging'
import { currentTenant } from '../tenancy'
import { ComposeLockService } from './compose-lock.service'
import {
  assignConversation,
  CONVERSATION_INCLUDE,
  searchConversations,
  toConversation,
} from './inbox.core'
import { createNotification, toNotification } from '../notifications'

const encodeOffset = (n: number) => Buffer.from(JSON.stringify({ o: n })).toString('base64url')
/** Matches no real user (visibility()/CONVERSATION_INCLUDE only need *a* uuid for an API key). */
const NIL_USER_ID = '00000000-0000-0000-0000-000000000000'
function decodeOffset(cursor?: string): number {
  if (!cursor) return 0
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: number }).o
    if (Number.isInteger(o) && o >= 0) return o
  } catch {
    // fall through
  }
  throw new AppError('INVALID_CURSOR', 400, 'The pagination cursor is invalid.')
}

/** Views hide snoozed conversations; "resolved" is its own view (docs/INBOX.md → views). */
const ACTIVE: Prisma.ConversationWhereInput = { status: { in: ['OPEN', 'PENDING'] } }

/**
 * The shared inbox (docs/INBOX.md). Every read and write is tenant-bound (RLS); replies go
 * through MessagingService after the compose-lock rule.
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly messaging: MessagingService,
    private readonly locks: ComposeLockService,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------- reading

  async list(q: ConversationsQuery) {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const where: Prisma.ConversationWhereInput[] = [await this.visibility(tx, userId)]
      if (q.view === 'mine') where.push({ assigneeId: userId }, ACTIVE)
      else if (q.view === 'unassigned') where.push({ assigneeId: null }, ACTIVE)
      else if (q.view === 'takeover') where.push({ automationState: 'AGENT_TAKEOVER' }, ACTIVE)
      else if (q.view === 'resolved') where.push({ status: 'RESOLVED' })
      else if (q.view === 'all') where.push(ACTIVE)
      if (q.status) where.push({ status: q.status })
      if (q.assigneeId) where.push({ assigneeId: q.assigneeId })
      if (q.unassigned) where.push({ assigneeId: null })
      if (q.tagId) where.push({ tags: { some: { tagId: q.tagId } } })
      if (q.phoneNumberId) where.push({ phoneNumberId: q.phoneNumberId })
      const now = new Date()
      if (q.window === 'OPEN') where.push({ serviceWindowExpiresAt: { gt: now } })
      if (q.window === 'CLOSED')
        where.push({
          OR: [{ serviceWindowExpiresAt: null }, { serviceWindowExpiresAt: { lte: now } }],
        })
      if (q.unread)
        where.push({
          OR: [
            { readStates: { some: { userId, unreadCount: { gt: 0 } } } },
            { AND: [{ readStates: { none: { userId } } }, { inboundCount: { gt: 0 } }] },
          ],
        })
      let snippets: Map<string, string | null> | undefined
      if (q.q) {
        snippets = await searchConversations(tx, q.q)
        where.push({ id: { in: [...snippets.keys()] } })
      }
      const offset = decodeOffset(q.cursor)
      const orderBy: Prisma.ConversationOrderByWithRelationInput[] =
        q.sort === 'oldest_waiting'
          ? [{ lastCustomerMessageAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
          : [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      const rows = await tx.conversation.findMany({
        where: { AND: where },
        include: CONVERSATION_INCLUDE(userId),
        orderBy,
        skip: offset,
        take: q.limit + 1,
      })
      const hasMore = rows.length > q.limit
      return {
        items: rows.slice(0, q.limit).map((r) => toConversation(r, snippets?.get(r.id))),
        page: {
          nextCursor: hasMore ? encodeOffset(offset + q.limit) : null,
          hasMore,
          limit: q.limit,
        },
      }
    })
  }

  async get(id: string): Promise<Conversation> {
    // An API key has no per-user assignment visibility or unread count (docs/API_KEYS.md → the
    // allowlist is workspace-wide, never scoped to one agent); `find`'s visibility() only
    // restricts AGENT-role sessions, which an API key never is.
    const userId = currentApiKey() ? NIL_USER_ID : currentAuth().userId
    return this.tenantDb.run(async (tx) => toConversation(await this.find(tx, id, userId)))
  }

  /**
   * Newest first; `before` pages backwards. Includes SYSTEM event messages, unless `type` asks for
   * one kind of media (docs/INBOX.md → Media filter), which pages over `media_type` instead.
   */
  async thread(id: string, query: { limit: number; before?: string; type?: ThreadMediaFilter }) {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      const cursor = decodeCursor(query.before)
      let where: Prisma.MessageWhereInput = { conversationId: id, ...afterCursor(cursor) }
      if (query.type) {
        // media_type is a generated column Prisma can't see: page the ids in SQL (the
        // (conversation_id, media_type, created_at) index), then load the rows.
        const kind = MEDIA_FILTER_KIND[query.type]
        const ids = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM messages
          WHERE conversation_id = ${id}::uuid AND media_type = ${kind}
            AND (${!cursor} OR (created_at, id) < (${cursor?.createdAt ?? new Date(0)}, ${cursor?.id ?? id}::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT ${query.limit + 1}`
        where = { id: { in: ids.map((r) => r.id) } }
      }
      const rows = await tx.message.findMany({
        where,
        include: MESSAGE_FILE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const { items, page } = toPage(rows, query.limit)
      return { items: items.map(toMessage), page }
    })
  }

  /** Chip counts for the media filter; system events are not messages. */
  async mediaCounts(id: string): Promise<MediaCounts> {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      const [row] = await tx.$queryRaw<
        Array<{ all: bigint; image: bigint; video: bigint; document: bigint }>
      >`
        SELECT count(*) FILTER (WHERE direction <> 'SYSTEM') AS all,
               count(*) FILTER (WHERE media_type = 'IMAGE') AS image,
               count(*) FILTER (WHERE media_type = 'VIDEO') AS video,
               count(*) FILTER (WHERE media_type = 'DOCUMENT') AS document
        FROM messages WHERE conversation_id = ${id}::uuid`
      return {
        all: Number(row?.all ?? 0),
        image: Number(row?.image ?? 0),
        video: Number(row?.video ?? 0),
        document: Number(row?.document ?? 0),
      }
    })
  }

  async message(id: string): Promise<Message> {
    const row = await this.tenantDb.run((tx) => tx.message.findFirst({ where: { id } }))
    if (!row) throw AppError.notFound('Message not found.')
    return toMessage(row)
  }

  /** Nav badge: conversations with unread messages for the current user. */
  async unreadConversations(): Promise<number> {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) =>
      tx.conversation.count({
        where: {
          AND: [
            await this.visibility(tx, userId),
            { status: { not: 'RESOLVED' } },
            {
              OR: [
                { readStates: { some: { userId, unreadCount: { gt: 0 } } } },
                { AND: [{ readStates: { none: { userId } } }, { inboundCount: { gt: 0 } }] },
              ],
            },
          ],
        },
      }),
    )
  }

  // ------------------------------------------------------------------------------- replying

  /**
   * Reply rule (docs/INBOX.md → Collision control): the sender must hold the compose lock, or be
   * the assignee while it is free. A free lock is taken atomically for the send, so an API client
   * that never typed still can't race another agent.
   */
  async reply(id: string, content: SendableContent, idempotencyKey: string): Promise<Message> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const conversation = await this.tenantDb.run((tx) => this.find(tx, id, userId))
    const holder = await this.locks.get(id)
    if (holder && holder.userId !== userId)
      throw new AppError(
        'COMPOSE_LOCKED',
        409,
        `${holder.userName} is replying to this conversation.`,
        {
          holder: { id: holder.userId, name: holder.userName },
        },
      )
    if (!holder && conversation.assigneeId !== userId)
      await this.locks.acquire(tenantId, id, await this.me(), { force: false, canForce: false })
    const message = await this.messaging.send({
      tenantId,
      target: { conversationId: id },
      content,
      source: 'INBOX',
      idempotencyKey,
      actorUserId: userId,
    })
    await this.locks.release(tenantId, id, userId)
    this.realtime.toConversation(tenantId, id, 'conversation.updated', { conversationId: id })
    return message
  }

  async lock(id: string, force: boolean) {
    const { tenantId, permissions } = currentTenant()
    const { userId } = currentAuth()
    const conversation = await this.tenantDb.run((tx) => this.find(tx, id, userId))
    const canForce = conversation.assigneeId === userId || permissions.includes('inbox.reassign')
    return this.locks.acquire(tenantId, id, await this.me(), { force, canForce })
  }

  async unlock(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    await this.tenantDb.run((tx) => this.find(tx, id, userId))
    await this.locks.release(tenantId, id, userId)
  }

  async currentLock(id: string) {
    const { userId } = currentAuth()
    await this.tenantDb.run((tx) => this.find(tx, id, userId))
    return this.locks.dto(id, await this.locks.get(id))
  }

  // ------------------------------------------------------------------------------- actions

  async markRead(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const latestInbound = await this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      const latest = await tx.message.findFirst({
        where: { conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      await tx.conversationReadState.upsert({
        where: { conversationId_userId: { conversationId: id, userId } },
        create: {
          tenantId,
          conversationId: id,
          userId,
          unreadCount: 0,
          lastReadMessageId: latest?.id ?? null,
        },
        update: { unreadCount: 0, lastReadMessageId: latest?.id ?? null },
      })
      return tx.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND', providerMessageId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    })
    // Meta's blue ticks go out through the outbound worker (the only module that calls Meta).
    if (latestInbound)
      await this.queues.get(QUEUES.whatsappOutbound).add(
        MARK_READ_JOB,
        { tenantId, messageId: latestInbound.id },
        {
          jobId: jobId('read', latestInbound.id),
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      )
    this.realtime.toUser(userId, 'conversation.read', { conversationId: id })
  }

  async assign(id: string, assigneeId: string | null): Promise<Conversation> {
    const { tenantId, permissions } = currentTenant()
    const { userId } = currentAuth()
    const me = await this.me()
    const pushed = await this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id, userId)
      const selfClaim = assigneeId === userId && c.assigneeId === null
      const selfRelease = assigneeId === null && c.assigneeId === userId
      if (
        !selfRelease &&
        !(selfClaim && permissions.includes('inbox.assign_self')) &&
        !permissions.includes('inbox.reassign')
      )
        throw new AppError(
          'FORBIDDEN',
          403,
          c.assigneeId && c.assigneeId !== userId
            ? 'Only a manager can reassign a conversation that belongs to someone else.'
            : 'Your role can only assign conversations to yourself.',
        )
      return assignConversation(tx, {
        tenantId,
        conversation: c,
        assigneeId,
        actor: { id: userId, name: me.name },
      })
    })
    if (pushed) this.realtime.toUser(pushed.userId, 'notification.created', pushed.notification)
    this.realtime.toConversation(tenantId, id, 'conversation.assigned', {
      conversationId: id,
      assigneeId,
    })
    return this.get(id)
  }

  async setStatus(
    id: string,
    status: ConversationStatus,
    snoozedUntil?: string,
  ): Promise<Conversation> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const me = await this.me()
    await this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id, userId)
      if (c.status === status && status !== 'SNOOZED') return
      if (status === 'SNOOZED' && new Date(snoozedUntil!) <= new Date())
        throw AppError.validation([
          { path: 'snoozedUntil', code: 'past', message: 'Choose a time in the future.' },
        ])
      await tx.conversation.update({
        where: { id },
        data: {
          status,
          snoozedUntil: status === 'SNOOZED' ? new Date(snoozedUntil!) : null,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
        },
      })
      await writeSystemEvent(
        tx,
        { tenantId, conversationId: id, contactId: c.contactId },
        'status_changed',
        {
          actorId: userId,
          actorName: me.name,
          from: c.status,
          to: status,
          ...(snoozedUntil ? { snoozedUntil } : {}),
        },
      )
    })
    this.realtime.toConversation(tenantId, id, 'conversation.updated', { conversationId: id })
    return this.get(id)
  }

  /** Take over, pause, or return to automation (docs/INBOX.md → Human takeover). */
  async setAutomationState(id: string, state: AutomationState): Promise<Conversation> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const me = await this.me()
    await this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id, userId)
      if (c.automationState === state) return
      await tx.conversation.update({
        where: { id },
        data: {
          automationState: state,
          automationStateChangedAt: new Date(),
          automationStateChangedBy: userId,
        },
      })
      const event =
        state === 'AGENT_TAKEOVER'
          ? 'takeover'
          : state === 'AUTOMATION_PAUSED'
            ? 'automation_paused'
            : 'automation_resumed'
      await writeSystemEvent(tx, { tenantId, conversationId: id, contactId: c.contactId }, event, {
        actorId: userId,
        actorName: me.name,
        from: c.automationState,
        to: state,
      })
      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'conversation.automation_state.changed',
          aggregateType: 'conversation',
          aggregateId: id,
          payload: { conversationId: id, from: c.automationState, to: state, actorId: userId },
        },
      })
    })
    this.realtime.toConversation(tenantId, id, 'conversation.updated', { conversationId: id })
    return this.get(id)
  }

  async notes(id: string): Promise<ConversationNote[]> {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      const rows = await tx.conversationNote.findMany({
        where: { conversationId: id, deletedAt: null },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      })
      return rows.map((n) => ({
        id: n.id,
        conversationId: n.conversationId,
        body: n.body,
        authorId: n.authorId,
        authorName: n.author.name,
        mentions: n.mentions,
        createdAt: n.createdAt.toISOString(),
      }))
    })
  }

  async addNote(id: string, body: string, mentions: string[]): Promise<ConversationNote> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const me = await this.me()
    const { note, notices } = await this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      const members = mentions.length
        ? await tx.membership.findMany({
            where: { userId: { in: mentions }, status: 'ACTIVE' },
            select: { userId: true },
          })
        : []
      const valid = members.map((m) => m.userId).filter((m) => m !== userId)
      const note = await tx.conversationNote.create({
        data: { tenantId, conversationId: id, authorId: userId, body, mentions: valid },
      })
      const notices: Array<{ userId: string; notification: Notification }> = []
      for (const m of valid)
        notices.push({
          userId: m,
          notification: await createNotification(tx, {
            tenantId,
            userId: m,
            type: 'note.mention',
            title: `${me.name} mentioned you`,
            body: body.slice(0, 140),
            link: `/inbox?c=${id}`,
          }),
        })
      return { note, notices }
    })
    const dto: ConversationNote = {
      id: note.id,
      conversationId: id,
      body: note.body,
      authorId: userId,
      authorName: me.name,
      mentions: note.mentions,
      createdAt: note.createdAt.toISOString(),
    }
    this.realtime.toConversation(tenantId, id, 'note.created', dto)
    for (const n of notices) this.realtime.toUser(n.userId, 'notification.created', n.notification)
    return dto
  }

  async tag(id: string, tagId: string, on: boolean): Promise<Conversation> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    await this.tenantDb.run(async (tx) => {
      await this.find(tx, id, userId)
      if (!(await tx.tag.findFirst({ where: { id: tagId } })))
        throw AppError.notFound('Tag not found.')
      if (on)
        await tx.conversationTag.createMany({
          data: [{ tenantId, conversationId: id, tagId, createdBy: userId }],
          skipDuplicates: true,
        })
      else await tx.conversationTag.deleteMany({ where: { conversationId: id, tagId } })
    })
    this.realtime.toConversation(tenantId, id, 'conversation.updated', { conversationId: id })
    return this.get(id)
  }

  // ------------------------------------------------------------------------------- notifications

  async notifications(): Promise<{ items: Notification[]; unread: number }> {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.notification.count({ where: { userId, readAt: null } }),
      ])
      return { items: rows.map(toNotification), unread }
    })
  }

  async readNotification(id: string | 'all'): Promise<void> {
    const { userId } = currentAuth()
    await this.tenantDb.run((tx) =>
      tx.notification.updateMany({
        where: { userId, readAt: null, ...(id === 'all' ? {} : { id }) },
        data: { readAt: new Date() },
      }),
    )
  }

  // ------------------------------------------------------------------------------- settings

  async settings(): Promise<InboxSettings> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { autoAssign: true, inboxVisibility: true, takeoverAutoReleaseHours: true },
      }),
    )
  }

  async updateSettings(input: Partial<InboxSettings>): Promise<InboxSettings> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenantId },
        data: input,
        select: { autoAssign: true, inboxVisibility: true, takeoverAutoReleaseHours: true },
      })
      await this.audit.write(tx, {
        action: 'workspace.inbox_settings_updated',
        targetType: 'workspace',
        targetId: tenantId,
        changes: input,
      })
      return t
    })
  }

  // ------------------------------------------------------------------------------- helpers

  /** ASSIGNED_ONLY workspaces show agents only their own and unassigned conversations. */
  private async visibility(tx: TenantTx, userId: string): Promise<Prisma.ConversationWhereInput> {
    const { tenantId, role } = currentTenant() as { tenantId: string; role: string }
    if (role !== 'AGENT') return {}
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { inboxVisibility: true },
    })
    return t.inboxVisibility === 'ASSIGNED_ONLY'
      ? { OR: [{ assigneeId: userId }, { assigneeId: null }] }
      : {}
  }

  private async find(tx: TenantTx, id: string, userId: string) {
    const c = await tx.conversation.findFirst({
      where: { AND: [{ id }, await this.visibility(tx, userId)] },
      include: CONVERSATION_INCLUDE(userId),
    })
    if (!c) throw AppError.notFound('Conversation not found.')
    return c
  }

  private async me(): Promise<{ id: string; name: string }> {
    const { userId } = currentAuth()
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } }),
    )
    return user
  }
}
