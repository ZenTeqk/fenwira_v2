import { type Notification, type Role, ROLE_PERMISSIONS } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import {
  BILLING_OPTIONS,
  billingEnforcedFor,
  type BillingOptions,
  invoiceNoticeKey,
} from '../billing'
import {
  aiActivationDecisionEmail,
  invoiceNoticeEmail,
  Mailer,
  OpsAlerts,
  walletLowBalanceEmail,
} from '../platform'
import { invoiceNoticeCopy } from './invoice-notices'
import { createNotificationOnce } from './notifications'
import { NOTIFICATIONS_OPTIONS, type NotificationsOptions } from './notifications.options'

type WalletJob =
  EventJob<'wallet.low_balance'> | EventJob<'wallet.recovered'> | EventJob<'wallet.funded'>
type DispatchJob =
  | WalletJob
  | EventJob<'subscription.plan_requested'>
  | EventJob<'commercial.operation_completed'>
  | EventJob<'billing.invoice_notice'>
  | EventJob<'ai.activation.requested'>
  | EventJob<'ai.activation.decided'>

/** Roles that can view billing (ROLE_PERMISSIONS is the single source, never a hard-coded list). */
const BILLING_READERS = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) =>
  ROLE_PERMISSIONS[r].includes('billing.read'),
)
const AI_MANAGERS = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) =>
  ROLE_PERMISSIONS[r].includes('ai.manage'),
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
    if (e.eventType === 'billing.invoice_notice') return this.invoiceNotice(e.tenantId, e.payload)
    if (e.eventType === 'ai.activation.requested')
      return this.aiRequested(e.tenantId, e.payload.requestId)
    if (e.eventType === 'ai.activation.decided')
      return this.aiDecided(e.tenantId, e.payload.requestId)
    return 'ignored'
  }

  /**
   * Manual UPI billing emails (ADR-0027). The in-app notification is created once per member
   * (the API already created it for ISSUED/PAID/REJECTED); each member's email is then claimed
   * once by setting notifications.emailed_at, so redelivered events and the daily reminder job
   * never send twice. Reminders for an invoice that is no longer open (or has a pending proof)
   * are superseded. The Mailer never throws (fail soft, recorded in email_deliveries).
   */
  private async invoiceNotice(
    tenantId: string,
    p: {
      invoiceId: string
      notice: 'ISSUED' | 'DUE_SOON' | 'OVERDUE' | 'PAID' | 'REJECTED' | 'REMINDER'
      proofId?: string
      day?: string
    },
  ): Promise<string> {
    const key = invoiceNoticeKey(p.invoiceId, p.notice, p.proofId, p.day)
    const result = await this.db.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${key}`}))`
      const inv = await tx.invoice.findFirst({
        where: { id: p.invoiceId },
        include: {
          proofs: {
            select: { id: true, status: true, rejectionReason: true, receiptNumber: true },
          },
        },
      })
      if (!inv) return 'missing' as const
      const reminder = p.notice === 'DUE_SOON' || p.notice === 'OVERDUE' || p.notice === 'REMINDER'
      if (reminder && (inv.status !== 'OPEN' || inv.proofs.some((x) => x.status === 'PENDING')))
        return 'superseded' as const
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true },
      })
      const proof = p.proofId ? inv.proofs.find((x) => x.id === p.proofId) : undefined
      // A manual reminder reads like the automatic one for the invoice's current state.
      const notice =
        p.notice === 'REMINDER' ? (inv.dueAt <= new Date() ? 'OVERDUE' : 'DUE_SOON') : p.notice
      const copy = invoiceNoticeCopy(notice, {
        number: inv.number,
        amount: formatMoney(Number(inv.totalMinor), inv.currency),
        dueDate: inv.dueAt.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        }),
        receiptNumber: inv.proofs.find((x) => x.status === 'APPROVED')?.receiptNumber ?? null,
        reason: proof?.rejectionReason ?? null,
      })
      const members = await tx.membership.findMany({
        where: { status: 'ACTIVE', role: { in: BILLING_READERS } },
        select: { user: { select: { id: true, name: true, email: true } } },
      })
      const created: Array<{ userId: string; notification: Notification }> = []
      for (const { user } of members) {
        const notification = await createNotificationOnce(tx, {
          tenantId,
          userId: user.id,
          type: `billing.invoice_${p.notice.toLowerCase()}`,
          title: copy.subject,
          body: copy.lines[0]!,
          severity: copy.severity,
          link: `/billing/invoices?invoice=${inv.id}`,
          dedupeKey: key,
        })
        if (notification) created.push({ userId: user.id, notification })
      }
      const claimed = await tx.$queryRaw<Array<{ user_id: string }>>`
        UPDATE notifications SET emailed_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND dedupe_key = ${key} AND emailed_at IS NULL
        RETURNING user_id`
      const ids = new Set(claimed.map((c) => c.user_id))
      return {
        workspace: tenant.name,
        copy,
        invoiceId: inv.id,
        created,
        recipients: members.map((m) => m.user).filter((u) => ids.has(u.id)),
      }
    })
    if (typeof result === 'string') return result
    for (const c of result.created)
      this.realtime.toUser(c.userId, 'notification.created', c.notification)
    for (const user of result.recipients)
      await this.mailer.send(
        {
          to: user.email,
          ...invoiceNoticeEmail(
            user.name,
            result.workspace,
            result.copy,
            `${this.options.webOrigin}/billing/invoices?invoice=${result.invoiceId}`,
          ),
        },
        `invoice_${p.notice.toLowerCase()}`,
      )
    return `invoice-notice:${p.notice}:${result.recipients.length}`
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
      'Managed Launch, paid workspace: issue a PLAN_RENEWAL invoice for this plan in /platform → Billing operations',
    ])
    return 'plan-requested'
  }

  /** AI activation: the Fenwira team hears about every request (OPS_ALERT_EMAIL, via SES). */
  private async aiRequested(tenantId: string, requestId: string): Promise<string> {
    const info = await this.db.withTenant(tenantId, (tx) =>
      tx.aiActivationRequest.findFirst({
        where: { id: requestId },
        include: { tenant: { select: { name: true } }, plan: { select: { name: true } } },
      }),
    )
    if (!info || info.status !== 'REQUESTED') return 'ai-request-closed'
    await this.alerts.raise('ai.activation_requested', 'A workspace requested AI Assistant', [
      `workspace ${tenantId} (${info.tenant.name})`,
      `plan ${info.plan?.name ?? 'none (asked for pricing)'}`,
      `expected conversations per month: ${info.expectedConversations}`,
      `contact: ${info.contactEmail}${info.contactPhone ? `, ${info.contactPhone}` : ''}`,
      `use case: ${info.useCase}`,
      `review: ${this.options.webOrigin}/platform/ai-requests`,
    ])
    return 'ai-requested'
  }

  /**
   * AI activation decided: an in-app notification for members who manage AI (once per request)
   * and one email to the requester, sent only by the run that created their notification.
   */
  private async aiDecided(tenantId: string, requestId: string): Promise<string> {
    const result = await this.db.withTenant(tenantId, async (tx) => {
      const request = await tx.aiActivationRequest.findFirst({
        where: { id: requestId },
        include: { tenant: { select: { name: true } } },
      })
      if (!request || (request.status !== 'APPROVED' && request.status !== 'REJECTED')) return null
      const approved = request.status === 'APPROVED'
      const members = await tx.membership.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          OR: [{ role: { in: AI_MANAGERS } }, { userId: request.requestedBy }],
        },
        select: { user: { select: { id: true, name: true, email: true } } },
      })
      const created: Array<{
        user: { id: string; name: string; email: string }
        notification: Notification
      }> = []
      for (const { user } of members) {
        const notification = await createNotificationOnce(tx, {
          tenantId,
          userId: user.id,
          type: approved ? 'ai.activation_approved' : 'ai.activation_rejected',
          title: approved ? 'AI Assistant is on' : 'AI Assistant request not approved',
          body: approved
            ? 'The Fenwira team turned on AI Assistant. Add documents and test it before going live.'
            : request.decisionNote
              ? `Reason: ${request.decisionNote}`
              : 'The Fenwira team could not turn it on yet. You can send a new request.',
          link: '/ai-assistant',
          severity: approved ? 'INFO' : 'WARNING',
          dedupeKey: `ai-activation:${requestId}`,
        })
        if (notification) created.push({ user, notification })
      }
      return { request, approved, workspace: request.tenant.name, created }
    })
    if (!result) return 'ai-decision-missing'
    for (const c of result.created)
      this.realtime.toUser(c.user.id, 'notification.created', c.notification)
    const requester = result.created.find((c) => c.user.id === result.request.requestedBy)
    if (requester)
      await this.mailer
        .send(
          {
            to: requester.user.email,
            ...aiActivationDecisionEmail(
              requester.user.name,
              result.workspace,
              result.approved,
              result.request.decisionNote,
              `${this.options.webOrigin}/ai-assistant`,
            ),
          },
          'ai_activation',
        )
        .catch((err: unknown) =>
          this.logger.error({ err, requestId }, 'AI activation decision email failed'),
        )
    return `ai-decided:${result.created.length}`
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
