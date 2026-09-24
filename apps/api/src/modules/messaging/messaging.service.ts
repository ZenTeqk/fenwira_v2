import {
  MEDIA_LIMITS,
  type Message,
  type MessageContent,
  type MessageSource,
  type SendableContent,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { normalizePhone } from '../../core/phone'
import { previewOf, toMessage } from './messaging.mapper'

export type SendTarget = { conversationId: string } | { phoneE164: string; phoneNumberId?: string }

export type SendInput = {
  tenantId: string
  target: SendTarget
  content: SendableContent
  source: Exclude<MessageSource, 'CUSTOMER'>
  /** Required for every caller; the same key returns the same message and never sends twice. */
  idempotencyKey: string
  actorUserId?: string
  /** Consent purpose. Default: UTILITY for templates (categories arrive in Phase 8), SERVICE otherwise. */
  purpose?: 'MARKETING' | 'UTILITY' | 'SERVICE'
}

const SENDABLE_PHONE_STATUSES = ['CONNECTED', 'FLAGGED'] as const
const CONTACT_SOURCE = {
  INBOX: 'MANUAL',
  CAMPAIGN: 'CAMPAIGN',
  AUTOMATION: 'AUTOMATION',
  SYSTEM: 'MANUAL',
  API: 'API',
} as const
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/**
 * The single path for sending WhatsApp messages (docs/MESSAGING_ENGINE.md → MessagingService).
 * Validates, then writes the message (CREATED) and a `message.outbound.requested` outbox event in
 * one transaction. The relay enqueues whatsapp.outbound; only the outbound worker calls Meta.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async send(input: SendInput): Promise<Message> {
    const { tenantId } = input
    let created: { message: Message; conversationId: string } | null
    try {
      created = await this.db.withTenant(tenantId, (tx) => this.write(tx, input), {
        userId: input.actorUserId,
      })
    } catch (err) {
      // Two identical requests raced; the loser returns the winner's message.
      if (!isUniqueViolation(err)) throw err
      created = null
    }
    if (!created) return this.byIdempotencyKey(tenantId, input.idempotencyKey)
    this.realtime.toConversation(
      tenantId,
      created.conversationId,
      'message.created',
      created.message,
    )
    return created.message
  }

  private async byIdempotencyKey(tenantId: string, key: string): Promise<Message> {
    const existing = await this.db.withTenant(tenantId, (tx) =>
      tx.message.findFirst({ where: { idempotencyKey: key } }),
    )
    if (!existing) throw new AppError('CONFLICT', 409, 'The message could not be created.')
    return toMessage(existing)
  }

  private async write(
    tx: TenantTx,
    input: SendInput,
  ): Promise<{ message: Message; conversationId: string } | null> {
    const { tenantId, content } = input
    // 1. Idempotency
    if (await tx.message.findFirst({ where: { idempotencyKey: input.idempotencyKey } })) return null

    // 2–3. Number, contact and conversation
    const conversation = await this.resolveConversation(tx, input)
    if (!SENDABLE_PHONE_STATUSES.includes(conversation.phoneNumber.status as 'CONNECTED'))
      throw new AppError(
        'NO_CONNECTED_NUMBER',
        422,
        'This WhatsApp number is not connected. Check Settings → WhatsApp.',
      )
    if (conversation.contact.status === 'BLOCKED' || conversation.contact.deletedAt)
      throw new AppError('CONTACT_BLOCKED', 422, 'This contact is blocked.')

    // 4. Consent (docs/CONTACTS_AND_CONSENT.md → Enforcement).
    const purpose = input.purpose ?? (content.type === 'TEMPLATE' ? 'UTILITY' : 'SERVICE')
    if (purpose === 'MARKETING' && conversation.contact.marketingConsent !== 'GRANTED')
      throw new AppError(
        'CONSENT_REQUIRED',
        422,
        'This contact has not opted in to marketing messages.',
        { purpose },
      )
    if (purpose === 'UTILITY' && conversation.contact.utilityConsent === 'REVOKED')
      throw new AppError('CONSENT_REQUIRED', 422, 'This contact opted out of these messages.', {
        purpose,
      })
    // 5. Service window: anything but a template needs an open 24-hour window.
    const now = new Date()
    if (
      content.type !== 'TEMPLATE' &&
      !(conversation.serviceWindowExpiresAt && conversation.serviceWindowExpiresAt > now)
    )
      throw new AppError(
        'CONVERSATION_WINDOW_CLOSED',
        422,
        'The 24-hour window is closed. Send an approved template to restart the conversation.',
      )

    const stored = await this.storedContent(tx, content)
    const message = await tx.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: 'OUTBOUND',
        type: content.type,
        status: 'CREATED',
        source: input.source,
        purpose,
        content: stored as Prisma.InputJsonValue,
        fileId: 'fileId' in stored ? (stored.fileId ?? null) : null,
        idempotencyKey: input.idempotencyKey,
        sentByUserId: input.actorUserId ?? null,
      },
    })
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'message.outbound.requested',
        aggregateType: 'message',
        aggregateId: message.id,
        payload: { messageId: message.id },
        correlationId: requestContext.correlationId() ?? null,
      },
    })
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
        lastMessagePreview: previewOf(stored),
        ...(input.source === 'INBOX' && !conversation.firstResponseAt
          ? { firstResponseAt: now }
          : {}),
        // An agent replying takes the conversation over from automation (INBOX.md).
        ...(input.source === 'INBOX' && conversation.automationState === 'AUTOMATION_ACTIVE'
          ? {
              automationState: 'AGENT_TAKEOVER',
              automationStateChangedAt: now,
              automationStateChangedBy: input.actorUserId ?? null,
            }
          : {}),
      },
    })
    return { message: toMessage(message), conversationId: conversation.id }
  }

  private async resolveConversation(tx: TenantTx, input: SendInput) {
    const include = { contact: true, phoneNumber: true } as const
    if ('conversationId' in input.target) {
      const found = await tx.conversation.findFirst({
        where: { id: input.target.conversationId },
        include,
      })
      if (!found) throw AppError.notFound('Conversation not found.')
      return found
    }
    const phone = input.target.phoneNumberId
      ? await tx.whatsAppPhoneNumber.findFirst({
          where: { id: input.target.phoneNumberId, status: { not: 'DISCONNECTED' } },
        })
      : ((await tx.whatsAppPhoneNumber.findFirst({
          where: { isDefault: true, status: { not: 'DISCONNECTED' } },
        })) ??
        (await tx.whatsAppPhoneNumber.findFirst({
          where: { status: { in: [...SENDABLE_PHONE_STATUSES] } },
          orderBy: { createdAt: 'asc' },
        })))
    if (!phone)
      throw new AppError(
        'NO_CONNECTED_NUMBER',
        422,
        'Connect a WhatsApp number before sending messages.',
      )
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: input.tenantId },
      select: { defaultCountry: true },
    })
    const normalized = normalizePhone(input.target.phoneE164, tenant.defaultCountry)
    if (!normalized.ok)
      throw new AppError('INVALID_PHONE', 422, normalized.reason, undefined, [
        { path: 'to', code: 'invalid_phone', message: normalized.reason },
      ])
    const phoneE164 = normalized.e164
    const contact =
      (await tx.contact.findFirst({ where: { phoneE164, deletedAt: null } })) ??
      (await tx.contact.create({
        data: { tenantId: input.tenantId, phoneE164, source: CONTACT_SOURCE[input.source] },
      }))
    const conversation = await tx.conversation.upsert({
      where: {
        tenantId_contactId_phoneNumberId: {
          tenantId: input.tenantId,
          contactId: contact.id,
          phoneNumberId: phone.id,
        },
      },
      create: { tenantId: input.tenantId, contactId: contact.id, phoneNumberId: phone.id },
      update: {},
      include,
    })
    return conversation
  }

  /** Media sends reference a READY file of a type Meta accepts for that message type. */
  private async storedContent(tx: TenantTx, content: SendableContent): Promise<MessageContent> {
    if (content.type === 'TEXT' || content.type === 'TEMPLATE') return content
    const file = await tx.file.findFirst({
      where: { id: content.fileId, purpose: 'MESSAGE_MEDIA' },
    })
    if (!file || file.status !== 'READY')
      throw new AppError('FILE_NOT_READY', 422, 'The attachment is not uploaded yet.')
    const limit = MEDIA_LIMITS[content.type]
    if (!limit.mime.test(file.mimeType) || Number(file.sizeBytes) > limit.max)
      throw AppError.validation([
        {
          path: 'content.fileId',
          code: 'invalid_media',
          message: `This file can't be sent as ${content.type.toLowerCase()} on WhatsApp.`,
        },
      ])
    return {
      type: content.type,
      fileId: file.id,
      mimeType: file.mimeType,
      caption: content.caption,
      filename: content.filename ?? file.filename ?? undefined,
    }
  }
}
