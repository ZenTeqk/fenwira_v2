import { type PERMISSIONS, type Role, ROLE_PERMISSIONS } from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'

/** Who hears about the subscription: members whose role can view billing. */
export const BILLING_READER_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) =>
  ROLE_PERMISSIONS[r].includes('billing.read' satisfies keyof typeof PERMISSIONS),
)

export type LifecycleNotice = 'T-3' | 'T-1' | 'EXPIRED' | 'CANCELLED'
export type LifecycleResult = {
  notice: LifecycleNotice | null
  recipients: Array<{ id: string; name: string; email: string }>
  workspace: string
  trialEndsAt: Date | null
}

const DAY = 86_400_000
const addMonth = (d: Date) => {
  const n = new Date(d)
  n.setUTCMonth(n.getUTCMonth() + 1)
  return n
}

/**
 * One workspace's lifecycle step (docs/BILLING.md → Lifecycle). Idempotent: every transition is a
 * conditional update on the current status, and notices are recorded in `notices_sent`.
 * - TRIALING: T-3 and T-1 notices; at `trial_ends_at` → EXPIRED. Nothing is deleted; billable
 *   sends are refused (SUBSCRIPTION_INACTIVE) and running campaigns pause at their next dispatch.
 * - ACTIVE past `current_period_end`: cancel if `cancel_at_period_end`, else roll a month (no
 *   charge — there is no gateway, P11-D19).
 */
export async function stepSubscription(
  tx: TenantTx,
  tenantId: string,
  now: Date,
): Promise<LifecycleResult> {
  const sub = await tx.subscription.findUnique({ where: { tenantId } })
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true },
  })
  const result: LifecycleResult = {
    notice: null,
    recipients: [],
    workspace: tenant.name,
    trialEndsAt: sub?.trialEndsAt ?? null,
  }
  if (!sub) return result

  if (sub.status === 'TRIALING' && sub.trialEndsAt) {
    if (sub.trialEndsAt <= now) {
      const moved = await tx.subscription.updateMany({
        where: { tenantId, status: 'TRIALING' },
        data: { status: 'EXPIRED', expiredAt: now },
      })
      if (moved.count) {
        await audit(tx, tenantId, sub.id, 'subscription.expired', { trialEndsAt: sub.trialEndsAt })
        result.notice = 'EXPIRED'
      }
    } else {
      const left = sub.trialEndsAt.getTime() - now.getTime()
      const notice: LifecycleNotice | null =
        left <= DAY && !sub.noticesSent.includes('T-1')
          ? 'T-1'
          : left <= 3 * DAY && !sub.noticesSent.includes('T-3') && !sub.noticesSent.includes('T-1')
            ? 'T-3'
            : null
      if (notice) {
        await tx.subscription.update({
          where: { tenantId },
          data: { noticesSent: { push: notice } },
        })
        result.notice = notice
      }
    }
  } else if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd <= now) {
    if (sub.cancelAtPeriodEnd) {
      const moved = await tx.subscription.updateMany({
        where: { tenantId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: now },
      })
      if (moved.count) {
        await audit(tx, tenantId, sub.id, 'subscription.cancelled', {})
        result.notice = 'CANCELLED'
      }
    } else {
      await tx.subscription.updateMany({
        where: { tenantId, status: 'ACTIVE', currentPeriodEnd: sub.currentPeriodEnd },
        data: {
          currentPeriodStart: sub.currentPeriodEnd,
          currentPeriodEnd: addMonth(sub.currentPeriodEnd),
        },
      })
    }
  }

  if (!result.notice) return result
  const members = await tx.membership.findMany({
    where: { status: 'ACTIVE', role: { in: BILLING_READER_ROLES } },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  const copy = noticeCopy(result.notice, sub.trialEndsAt)
  for (const { user } of members) {
    // Same shape and dedupe as notifications' createNotificationOnce (billing can't import the
    // notifications module: it depends on billing, so that would be a cycle).
    const dedupeKey = `subscription:${sub.id}:${result.notice}`
    const seen = await tx.notification.findFirst({ where: { userId: user.id, dedupeKey } })
    if (seen) continue
    await tx.notification.create({
      data: {
        tenantId,
        userId: user.id,
        type: 'subscription.lifecycle',
        ...copy,
        link: '/billing/subscription',
        dedupeKey,
      },
    })
    result.recipients.push(user)
  }
  return result
}

export function noticeCopy(notice: LifecycleNotice, trialEndsAt: Date | null) {
  const when = trialEndsAt ? trialEndsAt.toUTCString().slice(0, 16) : ''
  switch (notice) {
    case 'T-3':
      return {
        title: 'Your trial ends in 3 days',
        body: `The trial ends ${when}. Request a plan to keep sending templates, campaigns and API access.`,
        severity: 'WARNING' as const,
      }
    case 'T-1':
      return {
        title: 'Your trial ends tomorrow',
        body: `The trial ends ${when}. Request a plan to avoid interruption.`,
        severity: 'WARNING' as const,
      }
    case 'EXPIRED':
      return {
        title: 'Your trial has ended',
        body: 'Template messages, campaigns, API keys and webhooks are paused. Your data is kept and inbound messages continue. Request a plan to resume.',
        severity: 'CRITICAL' as const,
      }
    case 'CANCELLED':
      return {
        title: 'Your subscription has ended',
        body: 'Template messages, campaigns, API keys and webhooks are paused. Your data is kept. Request a plan to resume.',
        severity: 'CRITICAL' as const,
      }
  }
}

async function audit(
  tx: TenantTx,
  tenantId: string,
  subscriptionId: string,
  action: string,
  changes: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'SYSTEM',
      action,
      targetType: 'subscription',
      targetId: subscriptionId,
      changes: changes as never,
    },
  })
}
