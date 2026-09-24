import { randomToken, sha256 } from '@fenwira/config'
import { EVENT_PAYLOAD_SCHEMAS, ROLE_LABELS, type Role } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { invitationEmail, Mailer } from '../platform'

const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000
export const TENANCY_WORKER_OPTIONS = Symbol('TENANCY_WORKER_OPTIONS')
export type TenancyWorkerOptions = { webOrigin: string }

/**
 * (Re)issues the invitation token and emails it. Each send replaces the previous token, so only
 * the latest link works; the raw token lives only in the email.
 */
@Injectable()
export class TenancyProcessor implements QueueProcessor<EventJob<'tenancy.invitation.sent'>> {
  readonly queue = QUEUES.tenancyEvents
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(TENANCY_WORKER_OPTIONS) private readonly options: TenancyWorkerOptions,
    private readonly mailer: Mailer,
  ) {}

  async process(job: Job<EventJob<'tenancy.invitation.sent'>>): Promise<void> {
    const { invitationId } = EVENT_PAYLOAD_SCHEMAS['tenancy.invitation.sent'].parse(
      job.data.payload,
    )
    const tenantId = job.data.tenantId
    if (!tenantId) throw new Error('tenancy.invitation.sent without tenantId')
    const token = randomToken()
    const mail = await this.db.withTenant(tenantId, async (tx) => {
      const inv = await tx.invitation.findFirst({
        where: { id: invitationId, tenantId, status: 'PENDING' },
        include: { tenant: true, invitedBy: true },
      })
      if (!inv) return null
      const now = new Date()
      await tx.invitation.update({
        where: { id: inv.id },
        data: {
          tokenHash: sha256(token),
          sentAt: now,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
      })
      return {
        to: inv.email,
        inviter: inv.invitedBy.name,
        workspace: inv.tenant.name,
        role: ROLE_LABELS[inv.role as Role],
      }
    })
    if (!mail) return
    const url = `${this.options.webOrigin}/invitations/${token}`
    await this.mailer.send({
      to: mail.to,
      ...invitationEmail(mail.inviter, mail.workspace, mail.role, url),
    })
  }
}
