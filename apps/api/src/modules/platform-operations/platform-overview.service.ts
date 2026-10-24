import {
  type PlatformOverview,
  type PlatformWorkspaceActivity,
  type PlatformWorkspaceRow,
} from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { ALL_QUEUE_NAMES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { QueueRegistry } from '../../core/queue/queue-registry'

type Raw = Omit<
  PlatformOverview,
  'revenueByMonth' | 'pendingPayments' | 'overdueWorkspaces' | 'queueBacklog' | 'attention'
>

/**
 * /platform overview and workspace activity (docs/MANAGED_LAUNCH.md → Billing operations, Monitor).
 * Aggregates come from grant-checked SECURITY DEFINER functions with column grants that exclude
 * message content, tokens, secrets and contact data.
 */
@Injectable()
export class PlatformOverviewService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
  ) {}

  private operator(): string {
    const id = requestContext.get()?.platform?.operatorId
    if (!id) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    return id
  }

  async overview(now = new Date()): Promise<PlatformOverview> {
    const operator = this.operator()
    const [raw, revenue, pending, overdue, backlog] = await Promise.all([
      this.db.system.platformOverview(operator, now) as Promise<Raw>,
      this.db.system.platformRevenueByMonth(operator, 12),
      this.db.system.platformPendingProofs(operator, 200),
      this.db.system.platformOverdueWorkspaces(operator, now),
      this.backlog(),
    ])
    const unhealthy = raw.connections.filter(
      (c) =>
        c.status !== 'CONNECTED' ||
        c.quality === 'RED' ||
        c.verifyOk === false ||
        (c.webhook !== null && c.webhook !== 'ACTIVE'),
    )
    const attention: PlatformOverview['attention'] = []
    if (pending.length)
      attention.push({
        kind: 'PENDING_UTR',
        title: `${pending.length} payment${pending.length === 1 ? '' : 's'} waiting for UTR verification`,
        href: '/platform/payments',
      })
    if (overdue.length)
      attention.push({
        kind: 'OVERDUE',
        title: `${overdue.length} workspace${overdue.length === 1 ? '' : 's'} overdue or suspended`,
        href: '/platform/payments',
      })
    for (const c of unhealthy)
      attention.push({
        kind: 'UNHEALTHY_CONNECTION',
        title: `${c.name}: WhatsApp ${c.number} needs attention (${[
          c.status !== 'CONNECTED' ? c.status.toLowerCase() : null,
          c.quality === 'RED' ? 'quality red' : null,
          c.verifyOk === false
            ? `verify failed${c.verifyErrorCode ? ` ${c.verifyErrorCode}` : ''}`
            : null,
          c.webhook && c.webhook !== 'ACTIVE' ? `webhook ${c.webhook.toLowerCase()}` : null,
        ]
          .filter(Boolean)
          .join(', ')})`,
        href: `/platform/workspaces/${c.workspaceId}`,
      })
    if (raw.emailFailures7d)
      attention.push({
        kind: 'EMAIL_FAILURES',
        title: `${raw.emailFailures7d} email${raw.emailFailures7d === 1 ? '' : 's'} failed in the last 7 days`,
        href: '/platform/email',
      })
    if (raw.accessRequests.new7d)
      attention.push({
        kind: 'NEW_ACCESS_REQUESTS',
        title: `${raw.accessRequests.new7d} new access request${raw.accessRequests.new7d === 1 ? '' : 's'} in the last 7 days`,
        href: '/platform/access-requests',
      })
    if (raw.accessRequests.unsent)
      attention.push({
        kind: 'UNSENT_LEADS',
        title: `${raw.accessRequests.unsent} access request${raw.accessRequests.unsent === 1 ? '' : 's'} not emailed`,
        href: '/platform/access-requests',
      })
    return {
      ...raw,
      revenueByMonth: revenue.map((r) => ({
        month: r.month.toISOString().slice(0, 7),
        currency: r.currency,
        totalMinor: Number(r.total_minor),
        payments: r.payments,
      })),
      pendingPayments: pending.length,
      overdueWorkspaces: overdue.length,
      queueBacklog: backlog,
      attention,
    }
  }

  async workspaceList(): Promise<PlatformWorkspaceRow[]> {
    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    const rows = await this.db.system.platformWorkspaceList(this.operator())
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at.toISOString(),
      internal: r.is_internal,
      ownerEmail: r.owner_email,
      plan: r.plan_key && r.plan_name ? { key: r.plan_key, name: r.plan_name } : null,
      status: r.subscription_status,
      trialEndsAt: iso(r.trial_ends_at),
      currentPeriodEnd: iso(r.current_period_end),
      nextDueAt: iso(r.next_due_at),
      openInvoices: r.open_invoices,
      openTotalMinor: r.open_total_minor.toString(),
      whatsapp: !r.numbers ? 'NONE' : r.unhealthy_numbers ? 'ATTENTION' : 'HEALTHY',
      lastMessageAt: iso(r.last_message_at),
    }))
  }

  async activity(workspaceId: string): Promise<PlatformWorkspaceActivity> {
    const operator = this.operator()
    const found = await this.db.system.platformWorkspaces(operator, workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId)) throw AppError.notFound('Workspace not found.')
    return this.db.withTenant(workspaceId, async (tx) => {
      const days = await tx.$queryRaw<Array<{ day: string; inbound: bigint; outbound: bigint }>>`
        SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
               count(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound
        FROM messages WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`
      const audit = await tx.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { action: true, actorType: true, createdAt: true },
      })
      return {
        messagesByDay: days.map((d) => ({
          day: d.day,
          inbound: Number(d.inbound),
          outbound: Number(d.outbound),
        })),
        recentAudit: audit.map((a) => ({
          action: a.action,
          actorType: String(a.actorType),
          createdAt: a.createdAt.toISOString(),
        })),
      }
    })
  }

  /** Waiting, delayed and failed jobs across every queue (BullMQ counts; no job data). */
  private async backlog() {
    const total = { waiting: 0, delayed: 0, failed: 0 }
    try {
      for (const name of ALL_QUEUE_NAMES) {
        const c = await this.queues.get(name).getJobCounts('waiting', 'delayed', 'failed')
        total.waiting += c.waiting ?? 0
        total.delayed += c.delayed ?? 0
        total.failed += c.failed ?? 0
      }
    } catch {
      // Redis unavailable: the overview still renders; health checks report Redis separately.
    }
    return total
  }
}
