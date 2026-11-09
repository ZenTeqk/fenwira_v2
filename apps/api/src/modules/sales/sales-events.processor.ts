import { type Notification } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { createNotificationOnce } from '../notifications'
import { customerLabel, followUpLink, salesEnabled } from './sales.core'

export const FOLLOW_UP_DUE_JOB = 'follow-up-due'
export const FOLLOW_UPS_SWEEP_JOB = 'follow-ups-sweep'

type DueJob = { tenantId: string; followUpId: string; version: number }
type SalesJob =
  | EventJob<'follow_up.scheduled'>
  | EventJob<'message.inbound.received'>
  | DueJob
  | { tenantId?: null }

type Notice = { userId: string; notification: Notification }

/**
 * sales.events (docs/FOLLOW_UPS_AND_SALES.md → Reminders):
 * - `follow_up.scheduled` arms one delayed job per (follow-up, version);
 * - the delayed job notifies the assignee when the follow-up is still pending, unchanged (same
 *   version), due, and not yet notified — so rescheduled, reassigned, cancelled or completed
 *   follow-ups make older jobs harmless, and duplicates notify once (row lock + dedupe key);
 * - a once-a-minute sweep recovers reminders whose delayed job was lost (Redis loss, worker
 *   downtime), bounded by the partial index on unnotified pending follow-ups;
 * - a customer message flags the conversation's pending follow-ups for review and tells their
 *   assignees once; it never completes them.
 */
@Injectable()
export class SalesEventsProcessor implements QueueProcessor<SalesJob>, OnApplicationBootstrap {
  readonly queue = QUEUES.salesEvents
  readonly concurrency = 5
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('SalesEvents')
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
        FOLLOW_UPS_SWEEP_JOB,
        { every: 60_000 },
        {
          name: FOLLOW_UPS_SWEEP_JOB,
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

  async process(job: Job<SalesJob>): Promise<unknown> {
    if (job.name === FOLLOW_UPS_SWEEP_JOB) return this.sweep()
    if (job.name === FOLLOW_UP_DUE_JOB) {
      const d = job.data as DueJob
      return this.notifyDue(d.tenantId, d.followUpId, d.version)
    }
    const e = job.data as EventJob
    if (!e.tenantId) return 'ignored'
    if (e.eventType === 'follow_up.scheduled') {
      const p = (e as EventJob<'follow_up.scheduled'>).payload
      return this.arm(e.tenantId, p.followUpId, p.version)
    }
    if (e.eventType === 'message.inbound.received') {
      const p = (e as EventJob<'message.inbound.received'>).payload
      return this.customerReplied(e.tenantId, p.messageId)
    }
    return 'ignored'
  }

  /** One delayed job per version; an already-due follow-up is handled now. */
  async arm(tenantId: string, followUpId: string, version: number): Promise<string> {
    const f = await this.db.withTenant(tenantId, (tx) =>
      tx.followUp.findFirst({
        where: { id: followUpId },
        select: { status: true, version: true, dueAt: true, dueNotifiedAt: true },
      }),
    )
    if (!f || f.status !== 'PENDING' || f.version !== version || f.dueNotifiedAt) return 'stale'
    const delay = f.dueAt.getTime() - Date.now()
    if (delay <= 0) return this.notifyDue(tenantId, followUpId, version)
    await this.queues
      .get(this.queue)
      .add(FOLLOW_UP_DUE_JOB, { tenantId, followUpId, version } satisfies DueJob, {
        jobId: jobId('fudue', followUpId, version),
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      })
    return 'armed'
  }

  /**
   * The reminder. `version` null (the sweep) means "whatever is current". Returns what happened;
   * only `notified` creates a notification.
   */
  async notifyDue(
    tenantId: string,
    followUpId: string,
    version: number | null,
    now = new Date(),
  ): Promise<string> {
    const result = await this.db.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT id FROM follow_ups WHERE id = ${followUpId}::uuid FOR UPDATE`
      const f = await tx.followUp.findFirst({
        where: { id: followUpId },
        include: { contact: { select: { name: true, waProfileName: true, phoneE164: true } } },
      })
      if (!f) return { outcome: 'missing' as const }
      if (f.status !== 'PENDING') return { outcome: 'closed' as const }
      if (version !== null && f.version !== version) return { outcome: 'stale' as const }
      if (f.dueNotifiedAt) return { outcome: 'already' as const }
      if (f.dueAt > now) return { outcome: 'early' as const }
      if (!(await salesEnabled(tx, tenantId))) return { outcome: 'disabled' as const }
      const member = await tx.membership.findFirst({
        where: { userId: f.assigneeId, status: 'ACTIVE' },
        select: { id: true },
      })
      await tx.followUp.update({ where: { id: f.id }, data: { dueNotifiedAt: now } })
      if (!member) return { outcome: 'no_assignee' as const }
      const notification = await createNotificationOnce(tx, {
        tenantId,
        userId: f.assigneeId,
        type: 'follow_up.due',
        severity: 'WARNING',
        title: 'Follow-up due',
        body: `${f.title} · ${customerLabel(f.contact)}`.slice(0, 200),
        link: followUpLink(tenantId, f),
        dedupeKey: `followup.due:${f.id}:${f.version}`,
      })
      return {
        outcome: 'notified' as const,
        notice: notification ? { userId: f.assigneeId, notification } : null,
        conversationId: f.conversationId,
        contactId: f.contactId,
      }
    })
    if (result.outcome === 'notified') {
      if (result.notice)
        this.realtime.toUser(
          result.notice.userId,
          'notification.created',
          result.notice.notification,
        )
      this.realtime.toTenant(tenantId, 'follow_up.changed', {
        id: followUpId,
        contactId: result.contactId,
        conversationId: result.conversationId,
      })
    }
    return result.outcome
  }

  /** Recovery for lost or late delayed jobs (X24). */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.db.system.followUpsDue(now, 200)
    let notified = 0
    for (const d of due)
      if ((await this.notifyDue(d.tenantId, d.followUpId, null, now)) === 'notified') notified++
    if (notified) this.logger.info({ count: notified }, 'follow-up reminders recovered by sweep')
    return notified
  }

  /**
   * A customer message flags the pending follow-ups of that conversation (and the contact's
   * follow-ups that aren't tied to a conversation) for review, once per follow-up, and tells
   * the assignee. Follow-ups created after the message aren't flagged by it.
   */
  async customerReplied(tenantId: string, messageId: string): Promise<string> {
    const notices = await this.db.withTenant(tenantId, async (tx) => {
      const m = await tx.message.findFirst({
        where: { id: messageId, direction: 'INBOUND' },
        select: { conversationId: true, contactId: true, createdAt: true },
      })
      if (!m || !(await salesEnabled(tx, tenantId))) return [] as Notice[]
      const pending = await tx.followUp.findMany({
        where: {
          status: 'PENDING',
          needsReviewAt: null,
          // Meta timestamps have whole-second precision: same-second follow-ups count as earlier.
          createdAt: { lt: new Date(m.createdAt.getTime() + 1000) },
          OR: [
            { conversationId: m.conversationId },
            { conversationId: null, contactId: m.contactId },
          ],
        },
        include: { contact: { select: { name: true, waProfileName: true, phoneE164: true } } },
        take: 50,
      })
      const out: Notice[] = []
      for (const f of pending) {
        // Conditional: a concurrent delivery of another message flags it only once.
        const flagged = await tx.followUp.updateMany({
          where: { id: f.id, status: 'PENDING', needsReviewAt: null },
          data: { needsReviewAt: m.createdAt },
        })
        if (!flagged.count) continue
        const member = await tx.membership.findFirst({
          where: { userId: f.assigneeId, status: 'ACTIVE' },
          select: { id: true },
        })
        if (!member) continue
        const notification = await createNotificationOnce(tx, {
          tenantId,
          userId: f.assigneeId,
          type: 'follow_up.customer_replied',
          title: 'Customer replied',
          body: `${customerLabel(f.contact)} replied. Review your follow-up: ${f.title}`.slice(
            0,
            200,
          ),
          link: followUpLink(tenantId, { id: f.id, conversationId: m.conversationId }),
          dedupeKey: `followup.reply:${f.id}:${messageId}`,
        })
        if (notification) out.push({ userId: f.assigneeId, notification })
      }
      return out
    })
    for (const n of notices) this.realtime.toUser(n.userId, 'notification.created', n.notification)
    if (notices.length) this.realtime.toTenant(tenantId, 'follow_up.changed', { messageId })
    return notices.length ? 'flagged' : 'none'
  }
}
