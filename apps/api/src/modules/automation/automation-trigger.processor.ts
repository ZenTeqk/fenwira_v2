import {
  businessHoursSchema,
  businessIsOpen,
  DEFAULT_BUSINESS_HOURS,
  normalizeReplyText,
  type FlowNode,
} from '@fenwira/contracts'
import { Database, type Prisma, type TenantTx } from '@fenwira/database'
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
  finishExecution,
  parseGraph,
  activeAiConversations,
  activeCandidates,
  aiStateOf,
  createTriggerRun,
  endAiConversation,
  enqueueExecution,
  keywordMatches,
  planOf,
  type StartEffects,
  lockExecution,
  stopConversationAutomation,
  triggerNodeOf,
  type TriggerEvent,
} from './automation.core'

import { replyState } from './reply-session'

type Data =
  | EventJob<'message.inbound.received'>
  | EventJob<'contact.created'>
  | EventJob<'conversation.automation_state.changed'>
  | EventJob<'conversation.resolved'>

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
      case 'conversation.resolved':
        return this.onResolved(e as EventJob<'conversation.resolved'>)
    }
    return 'ignored'
  }

  async onMessage(e: EventJob<'message.inbound.received'>): Promise<string> {
    const tenantId = e.tenantId!
    const resumed: Array<{ id: string; stage: number }> = []
    const result = await this.handle(tenantId, async (tx, effects, now) => {
      // Serialize routing per conversation. Session state itself is guarded by its row lock.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${e.payload.conversationId}, 1))::text`
      if (await tx.automationTriggerRun.findFirst({ where: { eventId: e.eventId } }))
        return 'duplicate'
      const message = await tx.message.findFirst({ where: { id: e.payload.messageId } })
      const conversation = await tx.conversation.findFirst({
        where: { id: e.payload.conversationId },
      })
      if (!message || !conversation) return 'missing'
      const text = textOf(message.content)
      if (conversation.automationState !== 'AUTOMATION_ACTIVE') return 'takeover'
      if (!conversation.serviceWindowExpiresAt || conversation.serviceWindowExpiresAt <= now)
        return 'window-closed'
      const workspace = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      const open = businessIsOpen(
        businessHoursSchema.parse(workspace.businessHours ?? DEFAULT_BUSINESS_HOURS),
        now,
      )
      let candidates = await activeCandidates(tx, ['trigger.keyword', 'trigger.message_received'])
      candidates = candidates.filter((c) => {
        const t = triggerNodeOf(c.graph)
        if (t?.type !== 'trigger.keyword' && t?.type !== 'trigger.message_received') return false
        if (
          t.config.phoneNumberIds?.length &&
          !t.config.phoneNumberIds.includes(conversation.phoneNumberId)
        )
          return false
        return (
          !t.config.businessHours ||
          t.config.businessHours === 'ANY' ||
          (t.config.businessHours === 'OPEN' ? open : !open)
        )
      })
      let restartFlowId: string | null = null
      const sessions = await tx.automationExecution.findMany({
        where: {
          conversationId: conversation.id,
          status: { in: ['RUNNING', 'WAITING'] },
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      })
      for (const session of sessions) {
        await lockExecution(tx, session.id)
        const fresh = await tx.automationExecution.findFirstOrThrow({ where: { id: session.id } })
        if (fresh.status !== 'RUNNING' && fresh.status !== 'WAITING') continue
        const v = await tx.flowVersion.findFirstOrThrow({ where: { id: fresh.flowVersionId } })
        const sessionGraph = parseGraph(v.graph)
        const settings = sessionGraph.replyStudio
        if (
          !sessionGraph.nodes.some(
            (n) => n.type === 'action.question' || n.type === 'action.options',
          )
        )
          continue
        const state = replyState(fresh)
        const restart = (settings?.restartWords ?? ['menu', 'restart', 'start over']).some(
          (w) => normalizeReplyText(w) === normalizeReplyText(text),
        )
        const expired =
          !!state.deadline && Date.parse(state.deadline) <= message.createdAt.getTime()
        if (restart || expired) {
          // Stop this event's remaining plan before ending the old session.
          if (fresh.triggerRunId)
            await tx.automationTriggerRun.update({
              where: { id: fresh.triggerRunId },
              data: {
                status: 'STOPPED',
                stopReason: restart ? 'SESSION_RESTART' : 'SESSION_EXPIRED',
                finishedAt: now,
              },
            })
          await finishExecution(
            tx,
            fresh,
            restart ? 'CANCELLED' : 'COMPLETED',
            { code: restart ? 'SESSION_RESTART' : 'SESSION_EXPIRED' },
            this.entitlements,
            now,
            effects,
          )
          if (restart) restartFlowId = fresh.flowId
          continue
        }
        // A durable inbox cursor consumes this message before any start keyword is evaluated.
        await tx.automationTriggerRun.create({
          data: {
            tenantId,
            eventId: e.eventId,
            triggerType: 'trigger.message_received',
            contactId: conversation.contactId,
            conversationId: conversation.id,
            triggerEvent: {
              type: 'session.reply',
              executionId: fresh.id,
              message: { id: message.id },
            },
            plan: [],
            status: 'COMPLETED',
            finishedAt: now,
          },
        })
        resumed.push({ id: fresh.id, stage: fresh.stepCount })
        return 'reply-resumed'
      }
      const byType = (c: (typeof candidates)[number]) => triggerNodeOf(c.graph)
      const keyword = candidates.filter((c) => {
        if (restartFlowId) return c.flow.id === restartFlowId
        const t = byType(c)
        return (
          t?.type === 'trigger.keyword' &&
          keywordMatches((t as NodeOf<'trigger.keyword'>).config, text)
        )
      })
      // An AI conversation in progress takes the message (docs/AI_ASSISTANT.md → Conversation
      // mode), unless a keyword flow matches: then the AI conversation ends and keywords win.
      if (conversation.automationState === 'AUTOMATION_ACTIVE')
        for (const ai of await activeAiConversations(tx, conversation.id)) {
          if (keyword.length) {
            await endAiConversation(tx, ai.id, 'KEYWORD_FLOW', this.entitlements, now, effects)
            continue
          }
          await lockExecution(tx, ai.id)
          const fresh = await tx.automationExecution.findFirst({ where: { id: ai.id } })
          if (!fresh || (fresh.status !== 'RUNNING' && fresh.status !== 'WAITING')) continue
          await tx.automationExecution.update({
            where: { id: fresh.id },
            data: {
              context: {
                ...(fresh.context as object),
                ai: { ...aiStateOf(fresh), pendingMessageId: message.id },
              } as Prisma.InputJsonValue,
              ...(fresh.status === 'WAITING' ? { status: 'RUNNING', waitUntil: null } : {}),
            },
          })
          // A RUNNING one picks the message up when its current answer is recorded.
          if (fresh.status === 'WAITING') resumed.push({ id: fresh.id, stage: fresh.stepCount })
          return 'ai-resumed'
        }
      if (!candidates.length) return 'no-flows'
      let matched = keyword
      // Keyword precedence: a matching keyword flow suppresses "message received" flows.
      if (!matched.length) {
        const first = !(await tx.message.findFirst({
          where: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            OR: [
              { createdAt: { lt: message.createdAt } },
              { createdAt: message.createdAt, id: { lt: message.id } },
            ],
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
      if (restartFlowId && !matched.length)
        matched = candidates.filter((c) => c.flow.id === restartFlowId)
      if (
        matched.some((c) => {
          const t = triggerNodeOf(c.graph)
          return t?.type === 'trigger.message_received' && t.config.onlyNewConversation
        })
      )
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conversation.contactId}, 2))::text`
      const eligible = []
      for (const c of matched) {
        const t = triggerNodeOf(c.graph)
        if (
          t?.type === 'trigger.message_received' &&
          t.config.onlyNewConversation &&
          (t.config.cooldownHours ?? 24) > 0 &&
          (await tx.automationExecution.findFirst({
            where: {
              flowId: c.flow.id,
              contactId: conversation.contactId,
              startedAt: {
                gte: new Date(now.getTime() - (t.config.cooldownHours ?? 24) * 3600000),
              },
            },
          }))
        )
          continue
        eligible.push(c)
      }
      matched = eligible
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
    for (const r of resumed)
      await enqueueExecution(this.queues, tenantId, r.id, r.stage, {
        suffix: `m${e.payload.messageId}`,
      })
    return result
  }

  /** Resolving a conversation ends its AI conversation (docs/AI_ASSISTANT.md). */
  async onResolved(e: EventJob<'conversation.resolved'>): Promise<string> {
    const tenantId = e.tenantId!
    let ended: Array<{ id: string; flowId: string }> = []
    await this.handle(tenantId, async (tx, effects, now) => {
      for (const ai of await activeAiConversations(tx, e.payload.conversationId)) {
        const done = await endAiConversation(
          tx,
          ai.id,
          'CONVERSATION_RESOLVED',
          this.entitlements,
          now,
          effects,
        )
        if (done) ended = [...ended, done]
      }
      return 'ai-ended'
    })
    for (const x of ended)
      this.realtime.toTenant(tenantId, 'automation.execution.updated', {
        executionId: x.id,
        flowId: x.flowId,
        status: 'COMPLETED',
      })
    if (ended.length)
      this.realtime.toConversation(tenantId, e.payload.conversationId, 'conversation.updated', {
        conversationId: e.payload.conversationId,
      })
    return `ended ${ended.length}`
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
