import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../../core/metrics/metrics.service'
import { Mailer } from './mailer'

export type OpsAlertOptions = { to?: string; environment: string }
export const OPS_ALERT_OPTIONS = Symbol('OPS_ALERT_OPTIONS')

/**
 * Operational alerts (decision O1, docs/OBSERVABILITY.md → Alerts): logged, counted, and emailed
 * to the configured operations address. Alerts carry IDs and counts only, never customer content.
 * A failed email never fails the job that raised the alert.
 */
@Injectable()
export class OpsAlerts {
  constructor(
    @Inject(OPS_ALERT_OPTIONS) private readonly options: OpsAlertOptions,
    private readonly mailer: Mailer,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('OpsAlerts')
  }

  async raise(kind: string, subject: string, lines: string[]): Promise<void> {
    this.metrics.opsAlerts.inc({ kind })
    this.logger.warn({ kind, details: lines }, subject)
    if (!this.options.to) return
    const title = `[Fenwira ${this.options.environment}] ${subject}`
    const body = `${title}\n\n${lines.join('\n')}`
    try {
      await this.mailer.send({
        to: this.options.to,
        subject: title,
        text: `${body}\n`,
        html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${escapeHtml(body)}</pre>`,
      })
    } catch (err) {
      this.logger.error({ kind, err }, 'operations alert email failed')
    }
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
