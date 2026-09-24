import { type Conversation, type Message } from '@fenwira/contracts'
import { jobId, QUEUES } from '@fenwira/queue'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'
import { AppError } from '../../core/http/app-error'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { currentTenant } from '../tenancy'
import { CONVERSATION_INCLUDE, toConversation, toMessage } from './messaging.mapper'

export const MARK_READ_JOB = 'mark-read'

/**
 * Conversation and message reads (Phase 5 surface). Inbox filters, assignment and read states
 * arrive in Phase 7 (docs/INBOX.md).
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly queues: QueueRegistry,
  ) {}

  async list(query: { limit: number; cursor?: string }) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.conversation.findMany({
        where: afterCursor(decodeCursor(query.cursor)),
        include: CONVERSATION_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const { items, page } = toPage(rows, query.limit)
      return { items: items.map(toConversation), page }
    })
  }

  async get(id: string): Promise<Conversation> {
    const row = await this.tenantDb.run((tx) =>
      tx.conversation.findFirst({ where: { id }, include: CONVERSATION_INCLUDE }),
    )
    if (!row) throw AppError.notFound('Conversation not found.')
    return toConversation(row)
  }

  /** Newest first; `before` pages backwards through history. */
  async messages(id: string, query: { limit: number; before?: string }) {
    return this.tenantDb.run(async (tx) => {
      if (!(await tx.conversation.findFirst({ where: { id }, select: { id: true } })))
        throw AppError.notFound('Conversation not found.')
      const rows = await tx.message.findMany({
        where: { conversationId: id, ...afterCursor(decodeCursor(query.before)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const { items, page } = toPage(rows, query.limit)
      return { items: items.map(toMessage), page }
    })
  }

  async message(id: string): Promise<Message> {
    const row = await this.tenantDb.run((tx) => tx.message.findFirst({ where: { id } }))
    if (!row) throw AppError.notFound('Message not found.')
    return toMessage(row)
  }

  /** Blue ticks up to the newest customer message, sent by the outbound worker. */
  async markRead(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    const latest = await this.tenantDb.run((tx) =>
      tx.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND', providerMessageId: { not: null } },
        orderBy: { createdAt: 'desc' },
      }),
    )
    if (!latest) {
      await this.get(id)
      return
    }
    await this.queues.get(QUEUES.whatsappOutbound).add(
      MARK_READ_JOB,
      { tenantId, messageId: latest.id },
      {
        jobId: jobId('read', latest.id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    )
  }
}
