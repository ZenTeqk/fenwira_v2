import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { jobId, QUEUE_JOB_OPTIONS, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { previewOf, toE164, toMessage } from './messaging.mapper'
import { type StoredWebhookEvent, type WebhookJob } from './webhook-ingest.service'

const WINDOW_MS = 24 * 3600 * 1000
const MEDIA = new Set(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER'])

export const isFinalAttempt = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

/** Marks the webhook event FAILED on the last attempt so it shows up for triage. */
export async function markWebhookFailedIfFinal(
  db: Database,
  job: Job<WebhookJob>,
  err: unknown,
): Promise<void> {
  if (!isFinalAttempt(job)) return
  await db
    .withTenant(job.data.tenantId, (tx) =>
      tx.webhookEvent.update({
        where: { id: job.data.webhookEventId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
        },
      }),
    )
    .catch(() => undefined)
}

/**
 * whatsapp.inbound (docs/MESSAGING_ENGINE.md → whatsapp.inbound processor): contact →
 * conversation → message, service window, outbox, then media download in a child job.
 * Idempotent through webhook_events.status and the unique (tenant, provider_message_id).
 */
@Injectable()
export class InboundProcessor implements QueueProcessor<WebhookJob> {
  readonly queue = QUEUES.whatsappInbound
  readonly concurrency = 10

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async process(job: Job<WebhookJob>): Promise<unknown> {
    try {
      return await this.handle(job.data)
    } catch (err) {
      await markWebhookFailedIfFinal(this.db, job, err)
      throw err
    }
  }

  private async handle({ tenantId, webhookEventId }: WebhookJob) {
    const result = await this.db.withTenant(tenantId, async (tx) => {
      const row = await tx.webhookEvent.findFirst({ where: { id: webhookEventId } })
      if (!row || row.status !== 'RECEIVED') return null
      const event = row.payload as unknown as StoredWebhookEvent
      if (event.kind !== 'MESSAGE' || !event.phoneId) {
        await this.finish(tx, webhookEventId, 'IGNORED', 'not an inbound message')
        return null
      }
      return this.apply(tx, tenantId, webhookEventId, event)
    })
    if (!result) return 'skipped'
    const { message, conversationId } = result
    if (MEDIA.has(message.type))
      await this.queues
        .get(QUEUES.whatsappMedia)
        .add(
          'download',
          { tenantId, messageId: message.id },
          { ...QUEUE_JOB_OPTIONS[QUEUES.whatsappMedia], jobId: jobId('media', message.id) },
        )
    this.realtime.toConversation(tenantId, conversationId, 'message.created', toMessage(message))
    this.realtime.toConversation(tenantId, conversationId, 'conversation.updated', {
      conversationId,
    })
    return 'processed'
  }

  private async apply(
    tx: TenantTx,
    tenantId: string,
    webhookEventId: string,
    event: Extract<StoredWebhookEvent, { kind: 'MESSAGE' }>,
  ) {
    const m = event.message
    // Replays of a stored message end here. A true race loses on the unique index, rolls back,
    // and its retry takes this branch.
    if (
      await tx.message.findFirst({
        where: { providerMessageId: m.providerMessageId },
        select: { id: true },
      })
    ) {
      await this.finish(tx, webhookEventId, 'PROCESSED', 'duplicate message')
      return null
    }
    const at = new Date(m.timestamp)
    const phoneE164 = toE164(m.from)
    const existing = await tx.contact.findFirst({ where: { phoneE164, deletedAt: null } })
    const contact = existing
      ? await tx.contact.update({
          where: { id: existing.id },
          data: {
            waProfileName: m.profileName ?? existing.waProfileName,
            lastInboundAt:
              at > (existing.lastInboundAt ?? new Date(0)) ? at : existing.lastInboundAt,
          },
        })
      : await tx.contact.create({
          data: {
            tenantId,
            phoneE164,
            source: 'INBOUND',
            waProfileName: m.profileName ?? null,
            lastInboundAt: at,
          },
        })

    const key = { tenantId, contactId: contact.id, phoneNumberId: event.phoneId! }
    const before = await tx.conversation.findUnique({
      where: { tenantId_contactId_phoneNumberId: key },
    })
    const conversation =
      before ?? (await tx.conversation.create({ data: { ...key, status: 'OPEN' } }))
    // Blocked contacts: messages are still recorded, but the conversation stays resolved.
    const blocked = contact.status === 'BLOCKED'
    const opened = !blocked && (!before || before.status === 'RESOLVED')
    const unsnoozed = !blocked && before?.status === 'SNOOZED'

    const message = await tx.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        direction: 'INBOUND',
        type: m.type,
        status: 'RECEIVED',
        source: 'CUSTOMER',
        content: m.content as Prisma.InputJsonValue,
        providerMessageId: m.providerMessageId,
        providerTimestamp: at,
        // Threads sort by created_at: use the customer's send time so a burst processed in
        // parallel still reads in order.
        createdAt: at,
        replyToMessageId: m.replyToProviderMessageId
          ? ((
              await tx.message.findFirst({
                where: { providerMessageId: m.replyToProviderMessageId },
                select: { id: true },
              })
            )?.id ?? null)
          : null,
      },
    })

    const windowEnd = new Date(at.getTime() + WINDOW_MS)
    const newer = !conversation.lastCustomerMessageAt || at > conversation.lastCustomerMessageAt
    const newerMessage = !conversation.lastMessageAt || at >= conversation.lastMessageAt
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        inboundCount: { increment: 1 },
        ...(unsnoozed ? { status: 'OPEN', snoozedUntil: null } : {}),
        ...(opened ? { status: 'OPEN', resolvedAt: null } : {}),
        ...(blocked ? { status: 'RESOLVED', resolvedAt: new Date() } : {}),
        ...(newer ? { lastCustomerMessageAt: at, serviceWindowExpiresAt: windowEnd } : {}),
        ...(newerMessage
          ? {
              lastMessageId: message.id,
              lastMessageAt: message.createdAt,
              lastMessagePreview: previewOf(m.content),
            }
          : {}),
      },
    })
    // Unread: +1 for everyone tracking this conversation; the assignee always tracks it.
    await tx.conversationReadState.updateMany({
      where: { conversationId: conversation.id },
      data: { unreadCount: { increment: 1 } },
    })
    if (conversation.assigneeId)
      await tx.$executeRaw`
        INSERT INTO conversation_read_states (tenant_id, conversation_id, user_id, unread_count, updated_at)
        SELECT ${tenantId}::uuid, ${conversation.id}::uuid, ${conversation.assigneeId}::uuid,
               ${conversation.inboundCount + 1}, now()
        ON CONFLICT (conversation_id, user_id) DO NOTHING`
    const outbox = (eventType: string, payload: Record<string, string>) =>
      tx.outboxEvent.create({
        data: {
          tenantId,
          eventType,
          aggregateType: 'message',
          aggregateId: message.id,
          payload,
          correlationId: `whk:${webhookEventId}`,
        },
      })
    await outbox('message.inbound.received', {
      messageId: message.id,
      conversationId: conversation.id,
      contactId: contact.id,
    })
    // A first message from a new number creates the contact ("contact created" automations).
    if (!existing) await outbox('contact.created', { contactId: contact.id, source: 'INBOUND' })
    if (opened)
      await outbox('conversation.opened', {
        conversationId: conversation.id,
        contactId: contact.id,
        messageId: message.id,
      })
    await this.finish(tx, webhookEventId, 'PROCESSED')
    return { message, conversationId: conversation.id }
  }

  private finish(tx: TenantTx, id: string, status: 'PROCESSED' | 'IGNORED', reason?: string) {
    return tx.webhookEvent.update({
      where: { id },
      data: {
        status,
        processedAt: new Date(),
        attempts: { increment: 1 },
        lastError: reason ?? null,
      },
    })
  }
}
