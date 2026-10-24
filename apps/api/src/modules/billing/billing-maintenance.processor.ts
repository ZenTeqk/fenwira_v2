import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { Mailer, OpsAlerts, subscriptionNoticeEmail } from '../platform'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import {
  emitInvoiceNotice,
  issueRenewalIfDue,
  issueTrialInvoiceIfDue,
  TRIAL_INVOICE_DAYS,
} from './invoices.core'
import { noticeCopy, noticeLink, stepSubscription } from './subscriptions.core'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { ledgerFigures, recoverReservation } from './usage.core'

export const RECOVER_JOB = 'recover-reservations'
export const LEDGER_CHECK_JOB = 'ledger-check'
export const SUBSCRIPTIONS_JOB = 'subscriptions-tick'
export const INVOICE_REMINDERS_JOB = 'invoice-reminders'
const DEFAULT_GRACE_MINUTES = 360
const BATCH = 500

/**
 * billing.maintenance (docs/plans/PHASE_11_PLAN.md §2.1–2.2):
 * - every 5 minutes, recovers reservations whose message ended long ago without being settled;
 * - daily, compares every wallet's cached balance and holds with the ledger and alerts on drift.
 *   It never corrects anything: drift means a bug to investigate, not a number to overwrite.
 */
@Injectable()
export class BillingMaintenanceProcessor
  implements QueueProcessor, OnApplicationBootstrap, OnApplicationShutdown
{
  readonly queue = QUEUES.billingMaintenance
  readonly concurrency = 1
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
    @Inject(CORE_CONFIG) private readonly core: CoreConfig,
    private readonly queues: QueueRegistry,
    private readonly alerts: OpsAlerts,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    @Optional() private readonly mailer?: Mailer,
  ) {
    this.logger.setContext('BillingMaintenance')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    const opts = { removeOnComplete: 50, removeOnFail: 50 }
    try {
      const queue = this.queues.get(this.queue)
      await queue.upsertJobScheduler(
        'billing-recover-reservations',
        { every: 5 * 60_000 },
        { name: RECOVER_JOB, data: {}, opts },
      )
      await queue.upsertJobScheduler(
        'billing-subscriptions-tick',
        { every: 15 * 60_000 },
        { name: SUBSCRIPTIONS_JOB, data: {}, opts },
      )
      // Manual UPI billing reminders, daily at 09:00 IST (due within 3 days, overdue).
      await queue.upsertJobScheduler(
        'billing-invoice-reminders',
        { pattern: '30 3 * * *', tz: 'UTC' },
        { name: INVOICE_REMINDERS_JOB, data: {}, opts },
      )
      await queue.upsertJobScheduler(
        'billing-ledger-check',
        { pattern: '15 2 * * *', tz: 'UTC' },
        { name: LEDGER_CHECK_JOB, data: {}, opts },
      )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  /** BILLING_SUBSCRIPTIONS_ENFORCED: only then may lifecycle copy say anything is paused. */
  private get enforced(): boolean {
    return this.core.entitlements?.enforced ?? false
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RECOVER_JOB) return this.recoverStale()
    if (job.name === LEDGER_CHECK_JOB) return this.checkLedger()
    if (job.name === SUBSCRIPTIONS_JOB) return this.tickSubscriptions()
    if (job.name === INVOICE_REMINDERS_JOB) return this.remindInvoices()
    return 'ignored'
  }

  /** One recovery pass. Each reservation re-enters withTenant and re-checks (X17 is IDs only). */
  async recoverStale(now = new Date()): Promise<{ settled: number; released: number }> {
    const grace = this.options.reservationGraceMinutes ?? DEFAULT_GRACE_MINUTES
    const due = await this.db.system.staleReservations(
      new Date(now.getTime() - grace * 60_000),
      BATCH,
    )
    const counts = { settled: 0, released: 0 }
    const tenants = new Set<string>()
    for (const d of due) {
      const out = await this.db.withTenant(d.tenantId, (tx) =>
        recoverReservation(tx, d.tenantId, d.messageId, this.options),
      )
      if (out === 'none') continue
      counts[out]++
      tenants.add(d.tenantId)
      this.metrics.reservationRecoveries.inc({ outcome: out })
    }
    if (counts.settled + counts.released > 0)
      await this.alerts.raise(
        'billing.stale_reservations',
        `Recovered ${counts.settled + counts.released} stale wallet reservations`,
        [
          `Settled from recorded Meta pricing: ${counts.settled}`,
          `Released (no pricing received): ${counts.released}`,
          `Workspaces: ${tenants.size} (${[...tenants].join(', ')})`,
          `Grace period: ${grace} minutes. Holds should settle within minutes; recurring alerts point at lost status webhooks or a failing billing.usage consumer.`,
        ],
      )
    return counts
  }

  /** Daily ledger check (X18 is IDs only; figures are read per tenant). */
  async checkLedger(): Promise<number> {
    const drifted = await this.db.system.walletLedgerDrift(BATCH)
    this.metrics.ledgerDrift.set(drifted.length)
    if (drifted.length === 0) return 0
    const lines: string[] = []
    for (const d of drifted) {
      const f = await this.db.withTenant(d.tenantId, (tx) => ledgerFigures(tx, d.walletId))
      lines.push(
        `tenant ${d.tenantId} wallet ${d.walletId}: balance ${f.balanceMinor} vs ledger ${f.ledgerMinor}; reserved ${f.reservedMinor} vs active holds ${f.activeHoldsMinor}`,
      )
    }
    await this.alerts.raise(
      'billing.ledger_drift',
      `Wallet ledger drift in ${drifted.length} wallet(s)`,
      [...lines, 'Nothing was corrected. Investigate before adjusting (docs/BILLING.md → Wallet).'],
    )
    return drifted.length
  }

  /**
   * Daily manual-billing reminders (ADR-0027): queues one billing.invoice_notice per open invoice
   * that is due within 3 days or overdue and hasn't been emailed for that notice. The dispatch
   * worker re-checks the invoice and claims each email once, so reruns never send duplicates.
   */
  async remindInvoices(now = new Date()): Promise<string> {
    const manual = this.options.manual
    if (!manual?.enabled) return 'reminders:off'
    // First plan invoice for trials ending within TRIAL_INVOICE_DAYS (once per trial period).
    let trialInvoices = 0
    let afterTenant: string | null = null
    for (;;) {
      const ids = await this.db.system.trialsEnding(now, TRIAL_INVOICE_DAYS, BATCH, afterTenant)
      if (!ids.length) break
      for (const tenantId of ids) {
        try {
          const trialPlanKey = this.core.entitlements?.trialPlanKey ?? 'GROWTH'
          if (
            await this.db.withTenant(tenantId, (tx) =>
              issueTrialInvoiceIfDue(tx, tenantId, now, manual, trialPlanKey),
            )
          )
            trialInvoices++
        } catch (err) {
          this.logger.error({ err, tenantId }, 'trial invoice not issued')
        }
      }
      afterTenant = ids[ids.length - 1]!
    }
    let after: string | null = null
    let queued = 0
    for (;;) {
      const due = await this.db.system.invoiceRemindersDue(now, BATCH, after)
      if (!due.length) break
      for (const d of due) {
        try {
          await this.db.withTenant(d.tenantId, (tx) =>
            emitInvoiceNotice(tx, d.tenantId, d.invoiceId, d.notice),
          )
          queued++
        } catch (err) {
          this.logger.error({ err, tenantId: d.tenantId }, 'invoice reminder not queued')
        }
      }
      after = due[due.length - 1]!.invoiceId
    }
    return `trial-invoices:${trialInvoices}:reminders:${queued}`
  }

  /**
   * Phase 11 Step 4 lifecycle (X20 → per tenant): trial notices and expiry, cancel at period end,
   * monthly period roll. Each workspace is a separate transaction, so one failure can't block
   * the rest; repeats are no-ops.
   */
  async tickSubscriptions(now = new Date()): Promise<string> {
    let after: string | null = null
    let processed = 0,
      notices = 0
    for (;;) {
      const manual = this.options.manual
      // Manual billing (ADR-0027) also steps PAST_DUE workspaces and issues renewals in the lead
      // window; both lists are stepped idempotently (row lock + conditional transitions).
      const due = await this.db.system.subscriptionsDue(now, BATCH, after)
      const manualDue: string[] = manual?.enabled
        ? await this.db.system.manualBillingDue(now, manual.leadDays, BATCH, after)
        : []
      const tenantIds: string[] = [...new Set([...due, ...manualDue])].sort().slice(0, BATCH)
      if (!tenantIds.length) break
      processed += tenantIds.length
      for (const tenantId of tenantIds) {
        try {
          const r = await this.db.withTenant(tenantId, async (tx) => {
            const step = await stepSubscription(tx, tenantId, now, manual, this.enforced)
            if (manual?.enabled && (await issueRenewalIfDue(tx, tenantId, now, manual)))
              this.metrics.subscriptionTransitions.inc({ to: 'RENEWAL_INVOICED' })
            return step
          })
          if (!r.notice) continue
          notices++
          this.metrics.subscriptionTransitions.inc({ to: r.notice })
          if (!this.mailer) continue
          const managed = manual?.enabled ?? false
          const copy = noticeCopy(r.notice, r.trialEndsAt, {
            graceDays: manual?.graceDays ?? 0,
            enforced: this.enforced,
            managed,
          })
          for (const user of r.recipients)
            await this.mailer
              .send({
                to: user.email,
                ...subscriptionNoticeEmail(
                  user.name,
                  r.workspace,
                  copy,
                  `${this.options.webOrigin ?? ''}${noticeLink(managed)}`,
                  managed,
                ),
              })
              .catch((err: unknown) =>
                this.logger.error({ err, tenantId }, 'subscription notice email failed'),
              )
        } catch (err) {
          this.logger.error({ err, tenantId }, 'subscription lifecycle step failed')
        }
      }
      // Advance even when a row failed or remains warning-due. Restart safely begins at null;
      // row locks and persisted notices make the repeated first page harmless, never exclusive.
      after = tenantIds[tenantIds.length - 1]!
    }
    return `subscriptions:${processed}:notices:${notices}`
  }
}
