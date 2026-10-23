import { sha256 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { Inject, Injectable, type OnApplicationShutdown, Optional } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import nodemailer, { type Transporter } from 'nodemailer'

/** `smtpUrl` unset = no SMTP (ADR-0027 step 4): every email is recorded as SKIPPED_NO_SMTP. */
export type MailerOptions = { smtpUrl?: string; from: string; replyTo?: string }
export const MAILER_OPTIONS = Symbol('MAILER_OPTIONS')

/** `replyTo` overrides the configured Reply-To for this one email (e.g. a lead's own address). */
export type Email = { to: string; subject: string; text: string; html: string; replyTo?: string }
export type MailOutcome = 'SENT' | 'FAILED' | 'SKIPPED_NO_SMTP' | 'SUPPRESSED'

/** "a•••@example.com": enough for an operator to recognize, not a full address. */
export const recipientHint = (email: string) => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}

/**
 * SMTP only (Mailpit locally, SES in production — docs/ARCHITECTURE.md → Email). Worker-side.
 * Fails soft (ADR-0027 step 4): `send` never throws, so no queue is blocked by mail; every attempt
 * is recorded in `email_deliveries` (kind, outcome, error code, hashed recipient) for the operator
 * console. Never logs the recipient or body (docs/SECURITY.md → PII and logging).
 */
@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport: Transporter | null

  constructor(
    @Inject(MAILER_OPTIONS) private readonly options: MailerOptions,
    private readonly logger: PinoLogger,
    @Optional() @Inject(Database) private readonly db?: Database,
  ) {
    this.logger.setContext('Mailer')
    this.transport = options.smtpUrl ? nodemailer.createTransport(options.smtpUrl) : null
  }

  get configured(): boolean {
    return this.transport !== null
  }

  async send(email: Email, kind = 'other'): Promise<MailOutcome> {
    const recipientHash = sha256(email.to.trim().toLowerCase())
    if (await this.suppressed(recipientHash)) return this.record(kind, email.to, 'SUPPRESSED')
    if (!this.transport) {
      this.logger.warn({ kind, subject: email.subject }, 'email skipped: SMTP is not configured')
      return this.record(kind, email.to, 'SKIPPED_NO_SMTP')
    }
    try {
      const info = await this.transport.sendMail({
        from: this.options.from,
        ...(this.options.replyTo ? { replyTo: this.options.replyTo } : {}),
        ...email,
      })
      this.logger.info({ messageId: info.messageId, kind, subject: email.subject }, 'email sent')
      return this.record(kind, email.to, 'SENT')
    } catch (err) {
      const code = errorCode(err)
      this.logger.error({ kind, code }, 'email failed')
      return this.record(kind, email.to, 'FAILED', code)
    }
  }

  /** An address that hard-bounced or complained is skipped on later sends (step C hook). */
  private async suppressed(hash: Uint8Array): Promise<boolean> {
    if (!this.db) return false
    try {
      const row = await this.db.withGlobal((tx) =>
        tx.emailSuppression.findUnique({ where: { recipientHash: Uint8Array.from(hash) } }),
      )
      return row !== null
    } catch {
      return false
    }
  }

  private async record(
    kind: string,
    to: string,
    status: MailOutcome,
    errorCode?: string,
  ): Promise<MailOutcome> {
    try {
      await this.db?.withGlobal((tx) =>
        tx.emailDelivery.create({
          data: {
            kind,
            status,
            recipientHash: sha256(to.trim().toLowerCase()),
            recipientHint: recipientHint(to),
            errorCode: errorCode ?? null,
          },
        }),
      )
    } catch {
      this.logger.error({ kind }, 'email delivery record failed')
    }
    return status
  }

  onApplicationShutdown(): void {
    this.transport?.close()
  }
}

function errorCode(err: unknown): string {
  const e = err as { code?: string; responseCode?: number }
  return String(e?.responseCode ?? e?.code ?? 'ERROR').slice(0, 40)
}
