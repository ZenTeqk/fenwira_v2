import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { salesEnabled } from '../sales'
import {
  botHandling,
  endEpisode,
  evaluateEpisode,
  lockConversation,
  needsAttention,
  type Notice,
  openEpisode,
  SAME_SECOND_MS,
  startEpisode,
} from './response-alerts.core'

export const RESPONSE_ALERTS_SWEEP_JOB = 'response-alerts-sweep'

type AlertsJob =
  | EventJob<'message.inbound.received'>
  | EventJob<'message.outbound.sent'>
  | EventJob<'message.status.changed'>
  | EventJob<'conversation.automation_state.changed'>
  | EventJob<'automation.execution.finished'>
  | EventJob<'conversation.resolved'>
  | EventJob<'conversation.assigned'>
  | { tenantId?: null }

/**
 * inbox.alerts (docs/RESPONSE_ALERTS.md). Domain events open, pause and end "waiting for staff"
 * episodes; a once-a-minute check (X25, bounded by the next_check_at partial index) fires the
 * alert levels. Every handler takes the conversation's lock and re-reads state, so redelivered
 * or reordered events are harmless.
 */
@Injectable()
export class ResponseAlertsProcessor implements QueueProcessor<AlertsJob>, OnApplicationBootstrap {
  readonly queue = QUEUES.inboxAlerts
  readonly concurrency = 5
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ResponseAlerts')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues.get(this.queue).upsertJobScheduler(
        RESPONSE_ALERTS_SWEEP_JOB,
        { every: 60_000 },
        {
          name: RESPONSE_ALERTS_SWEEP_JOB,
          data: {},
          opts: { removeOnComplete: 50, removeOnFail: 50 },
        },
      )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job<AlertsJob>): Promise<unknown> {
    if (job.name === RESPONSE_ALERTS_SWEEP_JOB) return this.sweep()
    const e = job.data as EventJob
    if (!e.tenantId) return 'ignored'
    const at = new Date(e.occurredAt)
    switch (e.eventType) {
      case 'message.inbound.received':
        return this.inbound(
          e.tenantId,
          (e as EventJob<'message.inbound.received'>).payload.messageId,
        )
      case 'message.outbound.sent':
        return this.staffReply(
          e.tenantId,
          (e as EventJob<'message.outbound.sent'>).payload.messageId,
        )
      case 'message.status.changed': {
        const p = (e as EventJob<'message.status.changed'>).payload
        return ['SENT', 'DELIVERED', 'READ'].includes(p.to)
          ? this.staffReply(e.tenantId, p.messageId)
          : 'ignored'
      }
      case 'conversation.resolved':
        return this.resolved(
          e.tenantId,
          (e as EventJob<'conversation.resolved'>).payload.conversationId,
          at,
        )
      case 'conversation.automation_state.changed': {
        const p = (e as EventJob<'conversation.automation_state.changed'>).payload
        return this.botChanged(e.tenantId, p.conversationId, at)
      }
      case 'automation.execution.finished': {
        const p = (e as EventJob<'automation.execution.finished'>).payload
        const execution = await this.db.withTenant(e.tenantId, (tx) =>
          tx.automationExecution.findFirst({
            where: { id: p.executionId },
            select: { conversationId: true },
          }),
        )
        return execution?.conversationId
          ? this.botChanged(e.tenantId, execution.conversationId, at)
          : 'ignored'
      }
      case 'conversation.assigned':
        return this.recheck(
          e.tenantId,
          (e as EventJob<'conversation.assigned'>).payload.conversationId,
        )
      default:
        return 'ignored'
    }
  }

  /** A customer message starts an episode (or leaves the oldest open one untouched). */
  async inbound(tenantId: string, messageId: string, now = new Date()): Promise<string> {
    const result = await this.db.withTenant(tenantId, async (tx) => {
      if (!(await salesEnabled(tx, tenantId))) return { outcome: 'disabled' }
      const m = await tx.message.findFirst({
        where: { id: messageId, direction: 'INBOUND', source: 'CUSTOMER' },
        select: { id: true, conversationId: true, createdAt: true, type: true },
      })
      if (!m || !needsAttention(m.type)) return { outcome: 'ignored' }
      await lockConversation(tx, m.conversationId)
      return { outcome: await startEpisode(tx, tenantId, m, now), conversationId: m.conversationId }
    })
    if (result.outcome === 'started') this.changed(tenantId, result.conversationId!)
    return result.outcome
  }

  /**
   * A staff reply (source INBOX) accepted by Meta ends the wait for every customer message sent
   * before the reply was written. Failed sends never get here (no SENT), and automated messages
   * (acknowledgements, campaigns, API sends) are not staff replies.
   */
  async staffReply(tenantId: string, messageId: string, now = new Date()): Promise<string> {
    const result = await this.db.withTenant(tenantId, async (tx) => {
      const m = await tx.message.findFirst({
        where: {
          id: messageId,
          direction: 'OUTBOUND',
          source: 'INBOX',
          status: { in: ['SENT', 'DELIVERED', 'READ'] },
        },
        select: { id: true, conversationId: true, createdAt: true },
      })
      if (!m) return { ended: false }
      await lockConversation(tx, m.conversationId)
      const ended = await endEpisode(
        tx,
        tenantId,
        m.conversationId,
        new Date(m.createdAt.getTime() - SAME_SECOND_MS),
        'STAFF_REPLY',
        now,
        m.id,
      )
      return { ended, conversationId: m.conversationId }
    })
    if (result.ended) this.changed(tenantId, result.conversationId!)
    return result.ended ? 'ended' : 'none'
  }

  /**
   * Explicit resolution ends the wait. When a later customer message has already reopened the
   * conversation, only messages clearly before the resolution stop waiting; the rest start a new
   * episode.
   */
  async resolved(tenantId: string, conversationId: string, at: Date, now = new Date()) {
    const ended = await this.db.withTenant(tenantId, async (tx) => {
      await lockConversation(tx, conversationId)
      const c = await tx.conversation.findFirst({
        where: { id: conversationId },
        select: { status: true },
      })
      if (!c) return false
      const cutoff = c.status === 'RESOLVED' ? now : new Date(at.getTime() - SAME_SECOND_MS)
      return endEpisode(tx, tenantId, conversationId, cutoff, 'RESOLVED', now)
    })
    if (ended) this.changed(tenantId, conversationId)
    return ended ? 'ended' : 'none'
  }

  /**
   * Handover, takeover or a finished bot run: when no bot is handling the conversation any more,
   * the staff timer starts at that moment. Assignment never resets it.
   */
  async botChanged(tenantId: string, conversationId: string, at: Date, now = new Date()) {
    const outcome = await this.db.withTenant(tenantId, async (tx) => {
      await lockConversation(tx, conversationId)
      const ep = await openEpisode(tx, conversationId)
      if (!ep) return 'none'
      const c = await tx.conversation.findFirstOrThrow({
        where: { id: conversationId },
        select: { id: true, automationState: true },
      })
      if (await botHandling(tx, c)) {
        await tx.conversationWaitEpisode.update({
          where: { id: ep.id },
          data: { botHandling: true, clockStartedAt: null, nextCheckAt: null },
        })
        return 'bot'
      }
      if (ep.botHandling || !ep.clockStartedAt)
        await tx.conversationWaitEpisode.update({
          where: { id: ep.id },
          data: {
            botHandling: false,
            clockStartedAt: at < ep.startedAt ? ep.startedAt : at,
            nextCheckAt: now,
          },
        })
      return 'staff'
    })
    if (outcome !== 'none') this.changed(tenantId, conversationId)
    return outcome
  }

  /** Something that changes which levels apply (assignment): check again on the next sweep. */
  async recheck(tenantId: string, conversationId: string, now = new Date()) {
    return this.db.withTenant(tenantId, async (tx) => {
      const r = await tx.conversationWaitEpisode.updateMany({
        where: { conversationId, endedAt: null, botHandling: false },
        data: { nextCheckAt: now },
      })
      return r.count ? 'rechecked' : 'none'
    })
  }

  /** Once a minute: open episodes whose next check is due (X25). */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.db.system.waitEpisodesDue(now, 200)
    let alerts = 0
    for (const d of due) {
      const r = await this.db.withTenant(d.tenantId, async (tx) =>
        evaluateEpisode(tx, d.tenantId, d.episodeId, now, await salesEnabled(tx, d.tenantId)),
      )
      this.push(r.notices)
      if (r.conversationId && r.outcome !== 'checked' && r.outcome !== 'alerted')
        this.changed(d.tenantId, r.conversationId)
      alerts += r.notices.length
    }
    if (alerts) this.logger.info({ count: alerts }, 'response alerts sent')
    return alerts
  }

  private push(notices: Notice[]) {
    for (const n of notices) this.realtime.toUser(n.userId, 'notification.created', n.notification)
  }

  private changed(tenantId: string, conversationId: string) {
    this.realtime.toConversation(tenantId, conversationId, 'conversation.updated', {
      conversationId,
    })
  }
}
