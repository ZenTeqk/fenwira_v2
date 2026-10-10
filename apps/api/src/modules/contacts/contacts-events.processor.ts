import { type MessageContent } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { MessagingService } from '../messaging'
import { recordConsent } from './consent'

type ContactsEvent = EventJob<'message.inbound.received'> | EventJob<'message.status.changed'>

/** Meta error 131050 ("user stopped marketing messages") as it reaches us from either path. */
const OPTED_OUT_CODES = new Set(['META_131050', 'META_USER_OPTED_OUT'])
const normalizeKeyword = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()

/**
 * contacts.events (docs/CONTACTS_AND_CONSENT.md → How consent changes): whole-message opt-out /
 * opt-in keywords on inbound messages, and Meta's 131050 on a send. Idempotent: recordConsent is a
 * no-op when the contact is already in the target state, and the reply has an idempotency key.
 */
@Injectable()
export class ContactsEventsProcessor implements QueueProcessor<ContactsEvent> {
  readonly queue = QUEUES.contactsEvents
  readonly concurrency = 10

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly messaging: MessagingService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ContactsEvents')
  }

  async process(job: Job<ContactsEvent>): Promise<string> {
    const tenantId = job.data.tenantId
    if (!tenantId) return 'skipped'
    if (job.data.eventType === 'message.inbound.received')
      return this.keywords(tenantId, (job.data as EventJob<'message.inbound.received'>).payload)
    if (job.data.eventType === 'message.status.changed')
      return this.metaOptOut(tenantId, (job.data as EventJob<'message.status.changed'>).payload)
    return 'ignored'
  }

  private async keywords(
    tenantId: string,
    p: { messageId: string; conversationId: string; contactId: string },
  ): Promise<string> {
    const outcome = await this.db.withTenant(tenantId, async (tx) => {
      const message = await tx.message.findFirst({ where: { id: p.messageId } })
      const content = message?.content as MessageContent | undefined
      const text = content && 'text' in content ? content.text : undefined
      if (!text || text.length > 40) return null
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { optOutKeywords: true, optInKeywords: true, optOutReply: true },
      })
      const word = normalizeKeyword(text)
      const optOut = tenant.optOutKeywords.map(normalizeKeyword).includes(word)
      const optIn = !optOut && tenant.optInKeywords.map(normalizeKeyword).includes(word)
      if (!optOut && !optIn) return null
      const applied = await recordConsent(tx, {
        tenantId,
        contactId: p.contactId,
        purpose: 'MARKETING',
        status: optOut ? 'REVOKED' : 'GRANTED',
        source: 'INBOUND_KEYWORD',
        evidence: { messageId: p.messageId, keyword: word },
        actorId: null,
      })
      return { applied, optOut, reply: tenant.optOutReply }
    })
    if (!outcome) return 'no-keyword'
    if (outcome.applied && outcome.optOut && outcome.reply)
      await this.messaging.send({
        tenantId,
        target: { conversationId: p.conversationId },
        content: { type: 'TEXT', text: outcome.reply },
        source: 'SYSTEM',
        purpose: 'SERVICE',
        idempotencyKey: `sys:optout-reply:${p.messageId}`,
      })
    return outcome.applied ? (outcome.optOut ? 'opted-out' : 'opted-in') : 'unchanged'
  }

  private async metaOptOut(
    tenantId: string,
    p: { messageId: string; errorCode?: string },
  ): Promise<string> {
    if (!p.errorCode || !OPTED_OUT_CODES.has(p.errorCode)) return 'ignored'
    const applied = await this.db.withTenant(tenantId, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: p.messageId },
        select: { contactId: true },
      })
      if (!message) return false
      return recordConsent(tx, {
        tenantId,
        contactId: message.contactId,
        purpose: 'MARKETING',
        status: 'REVOKED',
        source: 'META_OPT_OUT',
        evidence: { messageId: p.messageId, errorCode: p.errorCode },
        actorId: null,
      })
    })
    return applied ? 'opted-out' : 'unchanged'
  }
}
