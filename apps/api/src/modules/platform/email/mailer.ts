import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import nodemailer, { type Transporter } from 'nodemailer'

export type MailerOptions = { smtpUrl: string; from: string }
export const MAILER_OPTIONS = Symbol('MAILER_OPTIONS')

export type Email = { to: string; subject: string; text: string; html: string }

/** SMTP only (Mailpit locally, SES later — docs/ARCHITECTURE.md → Email). Worker-side. */
@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport: Transporter

  constructor(
    @Inject(MAILER_OPTIONS) private readonly options: MailerOptions,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Mailer')
    this.transport = nodemailer.createTransport(options.smtpUrl)
  }

  async send(email: Email): Promise<void> {
    const info = await this.transport.sendMail({ from: this.options.from, ...email })
    // Never log the recipient or body (docs/SECURITY.md → PII and logging).
    this.logger.info({ messageId: info.messageId, subject: email.subject }, 'email sent')
  }

  onApplicationShutdown(): void {
    this.transport.close()
  }
}
