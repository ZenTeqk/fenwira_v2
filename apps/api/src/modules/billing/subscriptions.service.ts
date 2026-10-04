import {
  CAPABILITY_KEYS,
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  type EntitlementStatus,
  LIMIT_KEYS,
  type Plan,
  type Subscription,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { requestContext } from '../../core/context/request-context'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { EntitlementsService } from '../entitlements'
import { currentActorId } from '../identity'
import { currentTenant } from '../tenancy'

const DAY = 86_400_000

/**
 * Plans, the workspace's subscription and its resolved entitlements (Phase 11 Step 4,
 * docs/BILLING.md → Plans). Reads only; the one write here is an OWNER's plan *request* — plans
 * are activated by the Fenwira team (P11-D24), so this module never makes a workspace ACTIVE.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  plans(): Promise<Plan[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.plan.findMany({
        where: { isPublic: true },
        include: { entitlements: true, prices: { where: { active: true, interval: 'MONTH' } } },
        orderBy: { sort: 'asc' },
      })
      return rows.map((p) => {
        // Prices are not approved (P11-D4): null until an active monthly row exists.
        const price = p.prices[0]
        return {
          id: p.id,
          key: p.key,
          name: p.name,
          price: price
            ? {
                amountMinor: Number(price.amountMinor),
                currency: price.currency,
                interval: price.interval,
              }
            : null,
          entitlements: Object.fromEntries(
            p.entitlements.map((e) => [e.key, e.value as boolean | number | null]),
          ),
        }
      })
    })
  }

  subscription(): Promise<Subscription> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run((tx) => this.read(tx, tenantId))
  }

  /** Resolved limits and capabilities with current usage (every role: explains a 422). */
  entitlementStatus(): Promise<EntitlementStatus[]> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const out: EntitlementStatus[] = []
      for (const key of ENTITLEMENT_KEYS) {
        if ((CAPABILITY_KEYS as readonly string[]).includes(key)) {
          out.push({
            key,
            label: ENTITLEMENT_LABELS[key],
            kind: 'capability',
            enabled: await this.entitlements.isEnabled(tx, tenantId, key as never),
            limit: null,
            usage: null,
            overLimit: false,
          })
          continue
        }
        const limitKey = key as (typeof LIMIT_KEYS)[number]
        const [limit, usage] = await Promise.all([
          this.entitlements.getLimit(tx, tenantId, limitKey),
          this.entitlements.usage(tx, limitKey),
        ])
        out.push({
          key,
          label: ENTITLEMENT_LABELS[key],
          kind: 'limit',
          enabled: null,
          limit,
          usage,
          overLimit: limit !== null && usage !== null && usage > limit,
        })
      }
      return out
    })
  }

  /** P11-D24: records the OWNER's choice; operators are alerted and activate it. */
  requestPlan(planId: string): Promise<Subscription> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: planId, isPublic: true } })
      if (!plan) throw AppError.notFound('Plan not found.')
      await this.read(tx, tenantId) // ensures the row exists (lazy trial)
      const sub = await tx.subscription.update({
        where: { tenantId },
        data: { requestedPlanId: plan.id, requestedAt: new Date() },
      })
      await this.audit.write(tx, {
        action: 'subscription.plan_requested',
        targetType: 'subscription',
        targetId: sub.id,
        changes: { plan: plan.key },
      })
      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'subscription.plan_requested',
          aggregateType: 'subscription',
          aggregateId: sub.id,
          payload: { subscriptionId: sub.id, planId: plan.id },
          correlationId: requestContext.correlationId() ?? null,
        },
      })
      return this.read(tx, tenantId)
    })
  }

  /** Ends an active subscription at the end of its period (never immediately, never deletes). */
  cancel(): Promise<Subscription> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const moved = await tx.subscription.updateMany({
        where: { tenantId, status: 'ACTIVE' },
        data: { cancelAtPeriodEnd: true },
      })
      if (!moved.count)
        throw new AppError('CONFLICT', 409, 'Only an active subscription can be cancelled.')
      await this.audit.write(tx, {
        action: 'subscription.cancel_requested',
        targetType: 'subscription',
        targetId: null,
        changes: { by: currentActorId() },
      })
      return this.read(tx, tenantId)
    })
  }

  /** Shell banner summary for GET /workspace/status (every member). */
  banner() {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const s = await this.read(tx, tenantId)
      return { status: s.status, trialEndsAt: s.trialEndsAt, trialDaysLeft: s.trialDaysLeft }
    })
  }

  private async read(tx: TenantTx, tenantId: string): Promise<Subscription> {
    // Resolving entitlements creates a missing row (a lazy trial) and reports the live status,
    // e.g. EXPIRED for a trial past its end that the 15-minute job hasn't moved yet.
    const status = await this.entitlements.subscriptionStatus(tx, tenantId)
    const sub = await tx.subscription.findUnique({
      where: { tenantId },
      include: { plan: true, requestedPlan: true },
    })
    // No row yet (only possible while subscriptions aren't enforced): report the trial the
    // workspace would have — from its creation — without writing anything.
    const trialEndsAt =
      sub?.trialEndsAt ??
      (sub
        ? null
        : new Date(
            (
              await tx.tenant.findUniqueOrThrow({
                where: { id: tenantId },
                select: { createdAt: true },
              })
            ).createdAt.getTime() +
              (this.config.entitlements?.trialDays ?? 14) * DAY,
          ))
    const now = Date.now()
    const brief = (p: { id: string; key: string; name: string } | null | undefined) =>
      p ? { id: p.id, key: p.key, name: p.name } : null
    return {
      status: status ?? sub?.status ?? 'TRIALING',
      plan: brief(sub?.plan),
      requestedPlan: brief(sub?.requestedPlan),
      requestedAt: sub?.requestedAt?.toISOString() ?? null,
      interval: sub?.interval ?? 'MONTH',
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      trialDaysLeft:
        trialEndsAt && (status ?? sub?.status) === 'TRIALING'
          ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / DAY))
          : null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    }
  }

  /** Configured trial plan (for operator tooling). */
  get trialPlanKey(): string {
    return this.config.entitlements?.trialPlanKey ?? 'GROWTH'
  }
}
