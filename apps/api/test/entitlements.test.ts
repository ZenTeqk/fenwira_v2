import { describe, expect, it } from 'vitest'
import { EntitlementsService, SubscriptionEntitlementSource } from '../src/modules/entitlements'

/** Phase 11 Step 4 precedence (docs/BILLING.md → Plans): override > subscription profile > unset. */
const PLANS = {
  growth: { id: 'p-growth', key: 'GROWTH', ents: { api_enabled: true, max_contacts: 25_000 } },
  starter: { id: 'p-starter', key: 'STARTER', ents: { api_enabled: false, max_contacts: 5_000 } },
  business: {
    id: 'p-business',
    key: 'BUSINESS',
    ents: { api_enabled: true, max_contacts: 100_000 },
  },
}
const DAY = 86_400_000

function fakeTx(opts: {
  sub?: { status: string; planId?: string | null; trialEndsAt?: Date | null } | null
  overrides?: Array<{ key: string; value: unknown; expiresAt?: Date | null }>
  createdAt?: Date
  internal?: boolean
}) {
  let sub = opts.sub === undefined ? null : opts.sub
  const plan = (p: (typeof PLANS)[keyof typeof PLANS] | undefined) =>
    p
      ? {
          id: p.id,
          key: p.key,
          entitlements: Object.entries(p.ents).map(([key, value]) => ({ key, value })),
        }
      : null
  return {
    subscription: {
      findUnique: async () => sub,
      findUniqueOrThrow: async () => sub,
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        sub = { planId: null, ...(data[0] as { status: string; trialEndsAt: Date }) }
        return { count: 1 }
      },
    },
    tenant: {
      findUnique: async () => ({ isInternal: opts.internal ?? false }),
      findUniqueOrThrow: async () => ({ createdAt: opts.createdAt ?? new Date() }),
    },
    plan: {
      findUnique: async ({ where }: { where: { id?: string; key?: string } }) =>
        plan(Object.values(PLANS).find((p) => p.id === where.id || p.key === where.key)),
    },
    tenantEntitlementOverride: {
      findMany: async () =>
        (opts.overrides ?? []).filter((o) => !o.expiresAt || o.expiresAt > new Date()),
    },
  } as never
}

const source = (enforced = true) =>
  new SubscriptionEntitlementSource({ enforced, trialDays: 14, trialPlanKey: 'GROWTH' })
const service = (enforced = true) => {
  const s = new EntitlementsService()
  s.useSource(source(enforced))
  return s
}

describe('SubscriptionEntitlementSource', () => {
  it('not enforced: allow-all, exactly the pre-Step-4 behaviour', async () => {
    const s = service(false)
    const tx = fakeTx({ sub: { status: 'EXPIRED', planId: PLANS.starter.id } })
    expect(await s.apiEnabled(tx, 't')).toBe(true)
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBeNull()
    expect(await s.subscriptionActive(tx, 't')).toBe(true)
  })

  it('a trial resolves to the configured trial plan without being that plan', async () => {
    const s = service()
    const tx = fakeTx({ sub: { status: 'TRIALING', trialEndsAt: new Date(Date.now() + DAY) } })
    expect(await s.apiEnabled(tx, 't')).toBe(true)
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBe(25_000)
    expect(await s.subscriptionActive(tx, 't')).toBe(true)
  })

  it('an active subscription resolves to its plan', async () => {
    const s = service()
    const tx = fakeTx({ sub: { status: 'ACTIVE', planId: PLANS.starter.id } })
    expect(await s.apiEnabled(tx, 't')).toBe(false)
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBe(5_000)
  })

  it('an expired trial (even before the job runs) keeps limits but loses API/webhooks', async () => {
    const s = service()
    const tx = fakeTx({ sub: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY) } })
    expect(await s.subscriptionActive(tx, 't')).toBe(false)
    expect(await s.apiEnabled(tx, 't')).toBe(false)
    expect(await s.webhooksEnabled(tx, 't')).toBe(false)
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBe(25_000)
  })

  it('an override wins over the plan until it expires', async () => {
    const s = service()
    const tx = fakeTx({
      sub: { status: 'ACTIVE', planId: PLANS.starter.id },
      overrides: [
        { key: 'api_enabled', value: true },
        { key: 'max_contacts', value: 9, expiresAt: new Date(Date.now() - 1) },
      ],
    })
    expect(await s.apiEnabled(tx, 't')).toBe(true)
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBe(5_000)
  })

  it('an internal workspace gets Business limits, every capability on, whatever its row says', async () => {
    const s = service()
    const tx = fakeTx({
      sub: { status: 'SUSPENDED', planId: PLANS.starter.id },
      overrides: [{ key: 'api_enabled', value: false }],
      internal: true,
    })
    expect(await s.subscriptionStatus(tx, 't')).toBe('ACTIVE')
    expect(await s.getLimit(tx, 't', 'max_contacts')).toBe(100_000)
    expect(await s.isEnabled(tx, 't', 'api_enabled')).toBe(true)
  })

  it('unset keys stay enabled/unlimited', async () => {
    const s = service()
    const tx = fakeTx({ sub: { status: 'ACTIVE', planId: PLANS.starter.id } })
    expect(await s.getLimit(tx, 't', 'automation_execution_limit')).toBeNull()
    expect(await s.isEnabled(tx, 't', 'automation_enabled')).toBe(true)
  })

  it('creates the missing subscription as a trial from the workspace’s creation', async () => {
    const created = new Date(Date.now() - 3 * DAY)
    const s = service()
    const tx = fakeTx({ sub: null, createdAt: created })
    expect(await s.subscriptionActive(tx, 't')).toBe(true)
    const sub = await (
      tx as { subscription: { findUnique: () => Promise<{ trialEndsAt: Date }> } }
    ).subscription.findUnique()
    expect(sub.trialEndsAt.getTime()).toBe(created.getTime() + 14 * DAY)
  })

  it('refuses publishing a new flow when the subscription is inactive, never an already-active one', async () => {
    const s = service()
    const tx = fakeTx({ sub: { status: 'EXPIRED', planId: PLANS.starter.id } })
    expect((await s.canPublishFlow(tx, 't', false)).allowed).toBe(false)
    expect((await s.canPublishFlow(tx, 't', true)).allowed).toBe(true)
  })
})
