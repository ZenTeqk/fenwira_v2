import { randomToken, sha256 } from '@fenwira/config'
import { EVENT_PAYLOAD_SCHEMAS } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { Mailer, passwordResetEmail, verificationEmail } from '../platform'
import { IDENTITY_WORKER_OPTIONS, type IdentityWorkerOptions } from './identity-worker.options'

const VERIFY_TTL_MS = 24 * 3600 * 1000
const RESET_TTL_MS = 3600 * 1000

type IdentityEvent = EventJob<
  'identity.email_verification.requested' | 'identity.password_reset.requested'
>

/**
 * Creates single-use tokens and emails them. The raw token exists only in the email: the database
 * stores its SHA-256 and the outbox payload carries just the userId (docs/SECURITY.md).
 * A new token invalidates any unused older one, so only the latest link works.
 */
@Injectable()
export class IdentityProcessor implements QueueProcessor<IdentityEvent> {
  readonly queue = QUEUES.identityEvents
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(IDENTITY_WORKER_OPTIONS) private readonly options: IdentityWorkerOptions,
    private readonly mailer: Mailer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('IdentityProcessor')
  }

  async process(job: Job<IdentityEvent>): Promise<void> {
    const token = randomToken()
    const tokenHash = sha256(token)
    if (job.data.eventType === 'identity.email_verification.requested') {
      const { userId } = EVENT_PAYLOAD_SCHEMAS['identity.email_verification.requested'].parse(
        job.data.payload,
      )
      const user = await this.db.withGlobal(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: userId } })
        if (!u || u.emailVerifiedAt) return null
        await tx.emailVerificationToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: new Date() },
        })
        await tx.emailVerificationToken.create({
          data: { userId, tokenHash, expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
        })
        return u
      })
      if (!user) return
      const email = verificationEmail(
        user.name,
        `${this.options.webOrigin}/verify-email?token=${token}`,
      )
      await this.mailer.send({ to: user.email, ...email })
      return
    }
    const { userId } = EVENT_PAYLOAD_SCHEMAS['identity.password_reset.requested'].parse(
      job.data.payload,
    )
    const user = await this.db.withGlobal(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } })
      if (!u || u.disabledAt) return null
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      })
      await tx.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      })
      return u
    })
    if (!user) return
    await this.mailer.send({
      to: user.email,
      ...passwordResetEmail(user.name, `${this.options.webOrigin}/reset-password?token=${token}`),
    })
  }
}
