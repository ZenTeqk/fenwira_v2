import { CAPABILITY_KEYS, type EntitlementKey } from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'

export type EntitlementOptions = { enforced: boolean; trialDays: number; trialPlanKey: string }
export type EntitlementValue = boolean | number | null

/** Synthetic capability: the subscription is TRIALING (unexpired) or ACTIVE. */
export const SUBSCRIPTION_ACTIVE = 'subscription_active'
export type ResolvedEntitlements = {
  status: 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
  values: Map<string, EntitlementValue>
}

/** Capabilities withdrawn when a subscription is no longer active (P11-D6). */
const OFF_WHEN_INACTIVE: readonly string[] = ['api_enabled', 'webhooks_enabled']

/**
 * Plans → entitlements (docs/BILLING.md → Plans, precedence). Precedence, highest first:
 * 1. an unexpired `tenant_entitlement_overrides` row for the key;
 * 2. the subscription's profile — TRIALING: the configured trial plan's entitlements;
 *    ACTIVE: the subscribed plan's; EXPIRED/CANCELLED: the last plan's (or the trial plan's)
 *    limits, with `api_enabled`/`webhooks_enabled` off, so nothing turns over-limit by expiring;
 * 3. anything unset: enabled / unlimited.
 * Never branches on a plan key: plan identity is only used to look up its rows.
 */
export class SubscriptionEntitlementSource {
  private readonly cache = new WeakMap<object, Promise<ResolvedEntitlements>>()

  constructor(private readonly options: EntitlementOptions) {}

  resolve(tx: TenantTx, tenantId: string): Promise<ResolvedEntitlements> {
    if (!this.options.enforced)
      return Promise.resolve({ status: 'ACTIVE', values: new Map([[SUBSCRIPTION_ACTIVE, true]]) })
    // One resolution per transaction: changes apply on the next request, never mid-request.
    let hit = this.cache.get(tx)
    if (!hit) {
      hit = this.load(tx, tenantId)
      this.cache.set(tx, hit)
    }
    return hit
  }

  async enabled(tx: TenantTx, tenantId: string, key: string): Promise<boolean> {
    const v = (await this.resolve(tx, tenantId)).values.get(key)
    return v === undefined || v === null ? true : v === true
  }

  async limit(tx: TenantTx, tenantId: string, key: string): Promise<number | null> {
    const v = (await this.resolve(tx, tenantId)).values.get(key)
    return typeof v === 'number' ? v : null
  }

  private async load(tx: TenantTx, tenantId: string): Promise<ResolvedEntitlements> {
    const now = new Date()
    const sub = await this.ensureSubscription(tx, tenantId)
    const trialValid = sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt > now
    const status = sub.status === 'TRIALING' && !trialValid ? 'EXPIRED' : sub.status
    const active = status === 'ACTIVE' || status === 'TRIALING'

    const planId =
      status === 'TRIALING' ? null : (sub.planId ?? null) /* null → fall back to trial plan */
    const plan = planId
      ? await tx.plan.findUnique({ where: { id: planId }, include: { entitlements: true } })
      : await tx.plan.findUnique({
          where: { key: this.options.trialPlanKey },
          include: { entitlements: true },
        })

    const values = new Map<string, EntitlementValue>()
    for (const e of plan?.entitlements ?? []) values.set(e.key, e.value as EntitlementValue)
    if (!active) for (const k of OFF_WHEN_INACTIVE) values.set(k, false)
    values.set(SUBSCRIPTION_ACTIVE, active)

    const overrides = await tx.tenantEntitlementOverride.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    })
    for (const o of overrides) values.set(o.key, o.value as EntitlementValue)
    return { status, values }
  }

  /** Every workspace has a subscription; one created before Step 4 got a fresh trial on backfill. */
  private async ensureSubscription(tx: TenantTx, tenantId: string) {
    const existing = await tx.subscription.findUnique({ where: { tenantId } })
    if (existing) return existing
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { createdAt: true },
    })
    const trialEndsAt = new Date(tenant.createdAt.getTime() + this.options.trialDays * 86_400_000)
    await tx.subscription.createMany({
      data: [{ tenantId, status: 'TRIALING', trialEndsAt }],
      skipDuplicates: true,
    })
    return tx.subscription.findUniqueOrThrow({ where: { tenantId } })
  }
}

export const isCapability = (key: EntitlementKey) =>
  (CAPABILITY_KEYS as readonly string[]).includes(key)
