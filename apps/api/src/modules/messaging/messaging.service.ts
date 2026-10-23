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
import { uuidv7 } from '@fenwira/config'
import { countryOf } from '../../core/phone'
import { billingEnforcedFor, NO_BILLING, reserveForMessage } from '../billing'
import { resolveTemplateForSend, type ResolvedTemplate } from '../templates'
import { MessageEligibilityService } from './eligibility'
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options'
import { previewOf, toMessage } from './messaging.mapper'
import { writeSystemEvent } from './system-events'
import { EntitlementsService } from '../entitlements'

export type SendTarget = { conversationId: string } | { phoneE164: string; phoneNumberId?: string }

export type SendInput = {
  tenantId: string
  target: SendTarget
  content: SendableContent
  source: Exclude<MessageSource, 'CUSTOMER'>
  /** Required for every caller; the same key returns the same message and never sends twice. */
  idempotencyKey: string
  actorUserId?: string
  /** Consent purpose. Default: MARKETING for marketing templates, UTILITY for other templates, SERVICE otherwise. */
  purpose?: 'MARKETING' | 'UTILITY' | 'SERVICE'
  /** Links the message to its campaign (reporting, recipient status). */
  campaignId?: string
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
    private readonly eligibility: MessageEligibilityService,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
    private readonly entitlements: EntitlementsService,
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

    // 6. Template (docs/TEMPLATE_ENGINE.md → Rendering and sending): an APPROVED version of this
    // number's WABA with every variable. Its category decides the purpose and eligibility.
    const template =
      content.type === 'TEMPLATE'
        ? await resolveTemplateForSend(tx, {
            wabaRowId: conversation.phoneNumber.wabaId,
            templateVersionId: content.templateVersionId,
            name: content.name,
            language: content.language,
            variables: content.variables,
            rawComponents: content.components,
          })
        : null
    const purpose =
      template?.category === 'MARKETING'
        ? 'MARKETING'
        : (input.purpose ?? (template ? 'UTILITY' : 'SERVICE'))

    // 3–5. Eligibility: suppression, consent by purpose/category, service window — decided only
    // by MessageEligibilityService (docs/CONTACTS_AND_CONSENT.md → Eligibility, C1/C3).
    const now = new Date()
    this.eligibility.assert({
      purpose,
      category: template?.category,
      contentType: content.type,
      contact: conversation.contact,
      serviceWindowExpiresAt: conversation.serviceWindowExpiresAt,
      now,
    })

    // 7. Human takeover: automation never sends while an agent has the conversation.
    if (input.source === 'AUTOMATION' && conversation.automationState !== 'AUTOMATION_ACTIVE')
      throw new AppError(
        'AUTOMATION_BLOCKED_BY_TAKEOVER',
        422,
        'An agent has taken over this conversation; automation is paused.',
        { automationState: conversation.automationState },
      )
    // 8. Compose lock: enforced by the inbox before it calls send (docs/INBOX.md).

    // 8a. Suspension (ADR-0027, ML-D2): an unpaid workspace past its grace period sends nothing
    // new — campaigns, automations, inbox replies and API alike. Only SYSTEM messages (consent
    // and opt-out confirmations) still go out; inbound is never affected.
    if (
      input.source !== 'SYSTEM' &&
      (await this.entitlements.subscriptionStatus(tx, tenantId)) === 'SUSPENDED'
    )
      throw new AppError(
        'SUBSCRIPTION_SUSPENDED',
        422,
        'This workspace is suspended for an unpaid invoice. Pay it to resume sending.',
      )

    // 8b. Subscription (P11-D6): an expired or cancelled workspace keeps receiving and replying
    // in-window for free, but customer-initiated billable (template) sends are refused.
    if (
      template &&
      input.source !== 'SYSTEM' &&
      !(await this.entitlements.subscriptionActive(tx, tenantId))
    )
      throw new AppError(
        'SUBSCRIPTION_INACTIVE',
        422,
        'This workspace’s trial or subscription has ended. Request a plan to send template messages.',
      )

    // 9. Balance (B3/B4): a billable message reserves its estimated cost in this transaction.
    const messageId = uuidv7()
    const billing = this.options.billing ?? NO_BILLING
    if (template && (await billingEnforcedFor(tx, tenantId, billing)))
      await reserveForMessage(
        tx,
        tenantId,
        {
          messageId,
          category: template.category,
          country: conversation.contact.country ?? countryOf(conversation.contact.phoneE164),
        },
        billing,
      )

    const stored =
      template && content.type === 'TEMPLATE'
        ? await this.templateContent(tx, template, content)
        : await this.storedContent(tx, content)
    const message = await tx.message.create({
      data: {
        id: messageId,
        tenantId,
        campaignId: input.campaignId ?? null,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: 'OUTBOUND',
        type: content.type,
        status: 'CREATED',
        source: input.source,
        purpose,
        content: stored as Prisma.InputJsonValue,
        fileId: template
          ? template.headerFileId
          : 'fileId' in stored
            ? (stored.fileId ?? null)
            : null,
        templateVersionId: template?.versionId ?? null,
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
    if (input.source === 'INBOX' && conversation.automationState === 'AUTOMATION_ACTIVE') {
      // Running automation for this conversation stops (P10-D2).
      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'conversation.automation_state.changed',
          aggregateType: 'conversation',
          aggregateId: conversation.id,
          payload: {
            conversationId: conversation.id,
            from: 'AUTOMATION_ACTIVE',
            to: 'AGENT_TAKEOVER',
            actorId: input.actorUserId ?? null,
          },
        },
      })
      await writeSystemEvent(
        tx,
        { tenantId, conversationId: conversation.id, contactId: conversation.contactId },
        'takeover',
        {
          actorId: input.actorUserId ?? null,
          from: 'AUTOMATION_ACTIVE',
          to: 'AGENT_TAKEOVER',
          automatic: true,
        },
      )
    }
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
    let contact = await tx.contact.findFirst({ where: { phoneE164, deletedAt: null } })
    if (!contact) {
      // A person starting a conversation with a new number grows the contact list (plan limit);
      // campaign, automation and system sends only ever reach numbers that already exist or
      // came in on their own, so they're never refused for a commercial limit.
      if (input.source === 'INBOX' || input.source === 'API')
        await this.entitlements.assertWithin(tx, input.tenantId, 'max_contacts')
      contact = await tx.contact.create({
        data: { tenantId: input.tenantId, phoneE164, source: CONTACT_SOURCE[input.source] },
      })
    }
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
  /** What a template send stores: what was sent (for display) plus the Meta components. */
  private async templateContent(
    tx: TenantTx,
    t: ResolvedTemplate,
    content: Extract<SendableContent, { type: 'TEMPLATE' }>,
  ): Promise<MessageContent> {
    if (t.headerFileId) {
      const file = await tx.file.findFirst({
        where: { id: t.headerFileId, purpose: { in: ['MESSAGE_MEDIA', 'TEMPLATE_SAMPLE'] } },
      })
      if (!file || file.status !== 'READY')
        throw new AppError('FILE_NOT_READY', 422, "The template header file isn't uploaded yet.")
    }
    return {
      type: 'TEMPLATE',
      name: t.name,
      language: t.language,
      components: t.components,
      templateId: t.templateId,
      templateVersionId: t.versionId,
      category: t.category,
      ...(content.variables ? { variables: content.variables } : {}),
    }
  }

  private async storedContent(tx: TenantTx, content: SendableContent): Promise<MessageContent> {
    if (content.type === 'TEMPLATE') throw new Error('templates use templateContent')
    if (content.type === 'TEXT') return content
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
