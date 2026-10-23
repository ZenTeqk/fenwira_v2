import { EVENT_PAYLOAD_SCHEMAS } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { accessRequestEmail, Mailer, type MailOutcome } from '../platform'
import { LEADS_WORKER_OPTIONS, type LeadsWorkerOptions } from './leads.options'

const STATUS: Record<MailOutcome, 'EMAILED' | 'EMAIL_FAILED' | 'EMAIL_SKIPPED'> = {
  SENT: 'EMAILED',
  FAILED: 'EMAIL_FAILED',
  SKIPPED_NO_SMTP: 'EMAIL_SKIPPED',
  SUPPRESSED: 'EMAIL_SKIPPED',
}

/**
 * Emails a Request access lead to the team, Reply-To the visitor. Fails soft: the Mailer never
 * throws and records the attempt for the console Email page; the lead keeps the outcome. Safe to
 * run twice: an already-emailed lead is skipped.
 */
@Injectable()
export class LeadsProcessor implements QueueProcessor<EventJob<'leads.access_request.submitted'>> {
  readonly queue = QUEUES.leadsEvents
  readonly concurrency = 2

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(LEADS_WORKER_OPTIONS) private readonly options: LeadsWorkerOptions,
    private readonly mailer: Mailer,
  ) {}

  async process(job: Job<EventJob<'leads.access_request.submitted'>>): Promise<void> {
    const { accessRequestId } = EVENT_PAYLOAD_SCHEMAS['leads.access_request.submitted'].parse(
      job.data.payload,
    )
    const lead = await this.db.withGlobal((tx) =>
      tx.accessRequest.findUnique({ where: { id: accessRequestId } }),
    )
    if (!lead || lead.status === 'EMAILED') return
    const email = accessRequestEmail(lead, `${this.options.webOrigin}/platform/access-requests`)
    const outcome = await this.mailer.send(
      { to: this.options.teamEmail, replyTo: lead.email, ...email },
      'access_request',
    )
    await this.db.withGlobal((tx) =>
      tx.accessRequest.update({
        where: { id: lead.id },
        data: { status: STATUS[outcome], emailErrorCode: outcome === 'SENT' ? null : outcome },
      }),
    )
  }
}
