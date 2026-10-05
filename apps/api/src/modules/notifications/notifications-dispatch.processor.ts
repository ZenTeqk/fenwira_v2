import { type Notification, type Role, ROLE_PERMISSIONS } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { BILLING_OPTIONS, billingEnforcedFor, type BillingOptions } from '../billing'
import { Mailer, OpsAlerts, walletLowBalanceEmail } from '../platform'
import { createNotificationOnce } from './notifications'
import { NOTIFICATIONS_OPTIONS, type NotificationsOptions } from './notifications.options'

type WalletJob =
  EventJob<'wallet.low_balance'> | EventJob<'wallet.recovered'> | EventJob<'wallet.funded'>
type DispatchJob =
  WalletJob | EventJob<'subscription.plan_requested'> | EventJob<'commercial.operation_completed'>

/** Roles that can view billing (ROLE_PERMISSIONS is the single source, never a hard-coded list). */
const BILLING_READERS = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) =>
  ROLE_PERMISSIONS[r].includes('billing.read'),
)

export const formatMoney = (minor: number, currency: string) => {
  const f = new Intl.NumberFormat('en-IN', { style: 'currency', currency })
  return f.format(minor / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2))
}

/**
 * notifications.dispatch (docs/plans/PHASE_11_PLAN.md §2.3, §5.3). Wallet crossings notify the
 * members who can view billing: an in-app notification for every crossing and an email when
 * funds become low or run out. Nothing is sent when billing isn't enforced for the workspace, or
 * when a later change already superseded the crossing (for example a top-up right after it).
 * Redelivery is safe: notifications are deduplicated per event, and emails go only to members
 * whose notification was created by this run (so an email is sent at most once; the in-app
 * notification and the Billing page carry the state if an email is lost).
 */
@Injectable()
export class NotificationsDispatchProcessor implements QueueProcessor<DispatchJob> {
  readonly queue = QUEUES.notificationsDispatch
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BILLING_OPTIONS) private readonly billing: BillingOptions,
    @Inject(NOTIFICATIONS_OPTIONS) private readonly options: NotificationsOptions,
    private readonly mailer: Mailer,
    private readonly realtime: RealtimeEmitter,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly alerts: OpsAlerts,
  ) {
    this.logger.setContext('NotificationsDispatch')
  }

  async process(job: Job<DispatchJob>): Promise<string> {
    const e = job.data
    if (!e.tenantId) return 'ignored'
    if (e.eventType === 'commercial.operation_completed')
      return this.commercial(e.tenantId, e.payload.operationId)
    // P11-D21: first funding is not a recovery; it notifies only when it is already low.
    if (e.eventType === 'wallet.funded')
      return e.payload.to === 'LOW_BALANCE' ? this.wallet(e.tenantId, e) : 'funded'
    if (e.eventType === 'wallet.low_balance' || e.eventType === 'wallet.recovered')
      return this.wallet(e.tenantId, e)
    if (e.eventType === 'subscription.plan_requested')
      return this.planRequested(e.tenantId, e.payload)
    return 'ignored'
  }

  private async commercial(tenantId: string, operationId: string): Promise<string> {
    const created = await this.db.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:commercial-notification:${operationId}`}))`
      const created: Array<{ userId: string; notification: Notification }> = []
      const receipt = await tx.commercialOperation.findUniqueOrThrow({ where: { id: operationId } })
      const members = await tx.membership.findMany({
        where: { tenantId, status: 'ACTIVE', role: { in: BILLING_READERS } },
        select: { userId: true },
      })
      for (const member of members) {
        const notification = await createNotificationOnce(tx, {
          tenantId,
          userId: member.userId,
          type: 'commercial.operation_completed',
          title: 'Commercial support update',
          body: `The Fenwira team recorded ${receipt.operation.replaceAll('_', ' ')}. View billing for the updated state.`,
          link: receipt.amountMinor === null ? '/billing/subscription' : '/billing/wallet',
          dedupeKey: `commercial:${receipt.id}`,
        })
        if (notification) created.push({ userId: member.userId, notification })
      }
      return created
    })
    for (const item of created)
      this.realtime.toUser(item.userId, 'notification.created', item.notification)
    return 'commercial-notified'
  }

  /** P11-D24: plans are activated by the Fenwira team — they hear about every request. */
  private async planRequested(tenantId: string, p: { planId: string }): Promise<string> {
    const info = await this.db.withTenant(tenantId, async (tx) => ({
      tenant: await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true },
      }),
      plan: await tx.plan.findUnique({
        where: { id: p.planId },
        select: { key: true, name: true },
      }),
    }))
    await this.alerts.raise('billing.plan_requested', 'A workspace requested a plan', [
      `tenant ${tenantId} (${info.tenant.name})`,
      `plan ${info.plan?.key ?? p.planId} (${info.plan?.name ?? 'unknown'})`,
      `activate: pnpm --filter @fenwira/worker subscription:activate -- --tenant ${tenantId} --plan ${info.plan?.key ?? '<KEY>'}`,
    ])
    return 'plan-requested'
  }

  private async wallet(tenantId: string, e: WalletJob): Promise<string> {
    const to = e.eventType === 'wallet.recovered' ? 'NORMAL' : e.payload.to
    const type = e.eventType === 'wallet.funded' ? 'wallet.low_balance' : e.eventType
    const result = await this.db.withTenant(tenantId, async (tx) => {
      if (!(await billingEnforcedFor(tx, tenantId, this.billing))) return 'not-enforced' as const
      const wallet = await tx.wallet.findFirst({ where: { id: e.payload.walletId } })
      if (!wallet || wallet.fundsState !== to) return 'superseded' as const
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true },
      })
      const members = await tx.membership.findMany({
        where: { status: 'ACTIVE', role: { in: BILLING_READERS } },
        select: { user: { select: { id: true, name: true, email: true } } },
      })
      const available = formatMoney(e.payload.availableMinor, e.payload.currency)
      const copy =
        to === 'INSUFFICIENT_FUNDS'
          ? {
              title: 'Wallet is out of credits',
              body: `${available} available. Template messages are refused until credits are added.`,
              severity: 'CRITICAL' as const,
            }
          : to === 'LOW_BALANCE'
            ? {
                title: 'Wallet balance is low',
                body: `${available} available. Template messages stop when the balance runs out.`,
                severity: 'WARNING' as const,
              }
            : {
                title: 'Wallet balance restored',
                body: `${available} available. The balance is above the low-balance level again.`,
                severity: 'INFO' as const,
              }
      const created: Array<{
        user: { id: string; name: string; email: string }
        notification: Notification
      }> = []
      for (const { user } of members) {
        const notification = await createNotificationOnce(tx, {
          tenantId,
          userId: user.id,
          type,
          ...copy,
          link: '/billing/wallet',
          dedupeKey: `event:${e.eventId}`,
        })
        if (notification) created.push({ user, notification })
      }
      return { workspace: tenant.name, available, created }
    })
    if (typeof result === 'string') return result
    this.metrics.walletStateTransitions.inc({ to })
    for (const c of result.created)
      this.realtime.toUser(c.user.id, 'notification.created', c.notification)
    if (to !== 'NORMAL')
      for (const { user } of result.created)
        await this.mailer
          .send({
            to: user.email,
            ...walletLowBalanceEmail(
              user.name,
              result.workspace,
              to,
              result.available,
              `${this.options.webOrigin}/billing/wallet`,
              this.options.support,
            ),
          })
          .catch((err: unknown) =>
            this.logger.error({ err, eventId: e.eventId }, 'low-balance email failed'),
          )
    return `notified:${result.created.length}`
  }
}
