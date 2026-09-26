import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { writeSystemEvent } from '../messaging'
import { assignRoundRobin } from './round-robin'
import { PresenceService } from './presence.service'

export const MAINTENANCE_JOB = 'maintenance'
type InboxJob = EventJob<'conversation.opened'> | { tenantId?: null }

/**
 * inbox.events: round-robin auto-assignment on `conversation.opened` (docs/INBOX.md →
 * Assignment), and a once-a-minute maintenance pass that ends snoozes and releases idle takeovers.
 */
@Injectable()
export class InboxEventsProcessor implements QueueProcessor<InboxJob>, OnApplicationBootstrap {
  readonly queue = QUEUES.inboxEvents
  readonly concurrency = 5
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('InboxEvents')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues.get(this.queue).upsertJobScheduler(
        'inbox-maintenance',
        { every: 60_000 },
        {
          name: MAINTENANCE_JOB,
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

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  async process(job: Job<InboxJob>): Promise<unknown> {
    if (job.name === MAINTENANCE_JOB) return this.maintenance()
    const e = job.data as EventJob<'conversation.opened'>
    if (e.eventType === 'conversation.opened' && e.tenantId)
      return this.autoAssign(e.tenantId, e.payload.conversationId)
    return 'ignored'
  }

  /** Auto-assign on open when the tenant uses ROUND_ROBIN (docs/INBOX.md → Assignment). */
  async autoAssign(tenantId: string, conversationId: string): Promise<string> {
    const enabled = await this.db.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { autoAssign: true },
      })
      const c = await tx.conversation.findFirst({ where: { id: conversationId } })
      return tenant.autoAssign === 'ROUND_ROBIN' && !!c && !c.assigneeId
    })
    if (!enabled) return 'skipped'
    const result = await assignRoundRobin(
      this.db,
      this.presence,
      tenantId,
      conversationId,
      this.realtime,
    )
    if (result === 'assigned')
      this.realtime.toConversation(tenantId, conversationId, 'conversation.assigned', {
        conversationId,
      })
    return result
  }

  async maintenance(now = new Date()): Promise<number> {
    const due = await this.db.system.inboxMaintenanceDue(now, 500)
    for (const d of due) {
      await this.db.withTenant(d.tenantId, async (tx) => {
        const c = await tx.conversation.findFirst({ where: { id: d.conversationId } })
        if (!c) return
        const ref = { tenantId: d.tenantId, conversationId: c.id, contactId: c.contactId }
        if (d.kind === 'UNSNOOZE' && c.status === 'SNOOZED') {
          await tx.conversation.update({
            where: { id: c.id },
            data: { status: 'OPEN', snoozedUntil: null },
          })
          await writeSystemEvent(tx, ref, 'status_changed', {
            actorId: null,
            from: 'SNOOZED',
            to: 'OPEN',
            reason: 'snooze_ended',
          })
        } else if (d.kind === 'RELEASE_TAKEOVER' && c.automationState === 'AGENT_TAKEOVER') {
          await tx.conversation.update({
            where: { id: c.id },
            data: {
              automationState: 'AUTOMATION_ACTIVE',
              automationStateChangedAt: now,
              automationStateChangedBy: null,
            },
          })
          await writeSystemEvent(tx, ref, 'automation_resumed', {
            actorId: null,
            from: 'AGENT_TAKEOVER',
            to: 'AUTOMATION_ACTIVE',
            reason: 'auto_release',
          })
        }
      })
      this.realtime.toConversation(d.tenantId, d.conversationId, 'conversation.updated', {
        conversationId: d.conversationId,
      })
    }
    if (due.length) this.logger.info({ count: due.length }, 'inbox maintenance applied')
    return due.length
  }
}
