import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { OpsAlerts } from '../platform'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { ledgerFigures, recoverReservation } from './usage.core'

export const RECOVER_JOB = 'recover-reservations'
export const LEDGER_CHECK_JOB = 'ledger-check'
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
    private readonly queues: QueueRegistry,
    private readonly alerts: OpsAlerts,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
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

  async process(job: Job): Promise<unknown> {
    if (job.name === RECOVER_JOB) return this.recoverStale()
    if (job.name === LEDGER_CHECK_JOB) return this.checkLedger()
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
}
