import { type FlowNode } from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { EntitlementsService } from '../entitlements'
import {
  activeCandidates,
  createTriggerRun,
  enqueueExecution,
  keywordMatches,
  planOf,
  type StartEffects,
  stopConversationAutomation,
  triggerNodeOf,
  type TriggerEvent,
} from './automation.core'

type Data =
  | EventJob<'message.inbound.received'>
  | EventJob<'contact.created'>
  | EventJob<'conversation.automation_state.changed'>

type NodeOf<T extends FlowNode['type']> = Extract<FlowNode, { type: T }>

/** Text a keyword can match: the message text, a media caption or a button/list reply title. */
function textOf(content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>
  for (const k of ['text', 'caption', 'title', 'payload'])
    if (typeof c[k] === 'string') return c[k] as string
  return ''
}

/**
 * automation.trigger (docs/AUTOMATION_ENGINE.md → Triggering): matches ACTIVE flows to an event,
 * applies keyword precedence and AE2 ordering, stores the plan as a trigger run (unique per
 * event, so redelivery is harmless) and starts the first flow. Takeover events stop running
 * executions of that conversation (P10-D2).
 */
@Injectable()
export class AutomationTriggerProcessor implements QueueProcessor<Data> {
  readonly queue = QUEUES.automationTrigger
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeEmitter,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AutomationTrigger')
  }

  async process(job: Job<Data>): Promise<unknown> {
    const e = job.data
    if (!e.tenantId) return 'ignored'
    switch (e.eventType) {
      case 'message.inbound.received':
        return this.onMessage(e as EventJob<'message.inbound.received'>)
      case 'contact.created':
        return this.onContactCreated(e as EventJob<'contact.created'>)
      case 'conversation.automation_state.changed':
        return this.onAutomationState(e as EventJob<'conversation.automation_state.changed'>)
    }
    return 'ignored'
  }

  async onMessage(e: EventJob<'message.inbound.received'>): Promise<string> {
    const tenantId = e.tenantId!
    return this.handle(tenantId, async (tx, effects, now) => {
      const message = await tx.message.findFirst({ where: { id: e.payload.messageId } })
      const conversation = await tx.conversation.findFirst({
        where: { id: e.payload.conversationId },
      })
      if (!message || !conversation) return 'missing'
      const text = textOf(message.content)
      const candidates = await activeCandidates(tx, ['trigger.keyword', 'trigger.message_received'])
      if (!candidates.length) return 'no-flows'
      const byType = (c: (typeof candidates)[number]) => triggerNodeOf(c.graph)
      const keyword = candidates.filter((c) => {
        const t = byType(c)
        return (
          t?.type === 'trigger.keyword' &&
          keywordMatches((t as NodeOf<'trigger.keyword'>).config, text)
        )
      })
      let matched = keyword
      // Keyword precedence: a matching keyword flow suppresses "message received" flows.
      if (!matched.length) {
        const first = !(await tx.message.findFirst({
          where: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            id: { not: message.id },
            createdAt: { lte: message.createdAt },
          },
          select: { id: true },
        }))
        matched = candidates.filter((c) => {
          const t = byType(c)
          if (t?.type !== 'trigger.message_received') return false
          const cfg = (t as NodeOf<'trigger.message_received'>).config
          if (
            cfg.phoneNumberIds?.length &&
            !cfg.phoneNumberIds.includes(conversation.phoneNumberId)
          )
            return false
          return !cfg.onlyNewConversation || first
        })
      }
      if (!matched.length) return 'no-match'
      const event: TriggerEvent = {
        type: keyword.length ? 'trigger.keyword' : 'trigger.message_received',
        eventId: e.eventId,
        message: { id: message.id, type: message.type, text },
      }
      const run = await createTriggerRun(
        tx,
        {
          tenantId,
          event,
          contactId: conversation.contactId,
          conversationId: conversation.id,
          plan: planOf(matched),
        },
        this.entitlements,
        now,
        effects,
      )
      return run.created ? `planned ${matched.length}` : 'duplicate'
    })
  }

  async onContactCreated(e: EventJob<'contact.created'>): Promise<string> {
    const tenantId = e.tenantId!
    return this.handle(tenantId, async (tx, effects, now) => {
      const contact = await tx.contact.findFirst({
        where: { id: e.payload.contactId, deletedAt: null },
        select: { id: true },
      })
      if (!contact) return 'missing'
      const candidates = await activeCandidates(tx, ['trigger.contact_created'])
      const matched = candidates.filter((c) => {
        const t = triggerNodeOf(c.graph) as NodeOf<'trigger.contact_created'> | undefined
        const sources = t?.config.sources
        return !sources?.length || sources.includes(e.payload.source)
      })
      if (!matched.length) return candidates.length ? 'no-match' : 'no-flows'
      const run = await createTriggerRun(
        tx,
        {
          tenantId,
          event: {
            type: 'trigger.contact_created',
            eventId: e.eventId,
            contact: { source: e.payload.source },
          },
          contactId: contact.id,
          conversationId: null,
          plan: planOf(matched),
        },
        this.entitlements,
        now,
        effects,
      )
      return run.created ? `planned ${matched.length}` : 'duplicate'
    })
  }

  /** P10-D2: leaving AUTOMATION_ACTIVE stops this conversation's executions immediately. */
  async onAutomationState(e: EventJob<'conversation.automation_state.changed'>): Promise<string> {
    const to = e.payload.to
    if (to === 'AUTOMATION_ACTIVE') return 'active'
    const tenantId = e.tenantId!
    let stopped: Array<{ id: string; flowId: string }> = []
    await this.handle(tenantId, async (tx, effects, now) => {
      stopped = await stopConversationAutomation(
        tx,
        e.payload.conversationId,
        to === 'AUTOMATION_PAUSED' ? 'AUTOMATION_PAUSED' : 'AGENT_TAKEOVER',
        this.entitlements,
        now,
        effects,
      )
      return 'stopped'
    })
    for (const s of stopped) {
      this.metrics.automationExecutions.inc({ status: 'STOPPED_TAKEOVER' })
      this.realtime.toTenant(tenantId, 'automation.execution.updated', {
        executionId: s.id,
        flowId: s.flowId,
        status: 'STOPPED_TAKEOVER',
      })
    }
    return `stopped ${stopped.length}`
  }

  /** One transaction per event; started executions are enqueued after commit. */
  private async handle(
    tenantId: string,
    fn: (tx: TenantTx, effects: StartEffects, now: Date) => Promise<string>,
  ): Promise<string> {
    const effects: StartEffects = { enqueue: [], started: 0, skipped: 0 }
    const now = new Date()
    const result = await this.db.withTenant(tenantId, (tx) => fn(tx, effects, now))
    for (const id of effects.enqueue) {
      await enqueueExecution(this.queues, tenantId, id, 0)
      this.metrics.automationExecutions.inc({ status: 'STARTED' })
    }
    this.metrics.automationTriggerRuns.inc({ result: result.split(' ')[0]! })
    return result
  }
}
