import { PLAN_SEEDS, setPlanPriceSchema } from '@fenwira/contracts'
import { describe, expect, it, vi } from 'vitest'
import { requestContext } from '../src/core/context/request-context'
import { PlatformPlansService } from '../src/modules/platform-operations/platform-plans.service'

function service(known = true) {
  const audit: unknown[] = []
  const prices = new Map<string, number>([['GROWTH', 129900]])
  const tx = {
    plan: {
      findUnique: vi.fn(async () => (known ? { key: 'GROWTH' } : null)),
      findMany: vi.fn(async () =>
        [...prices].map(([key, amount]) => ({
          key,
          name: 'Growth',
          prices: [{ currency: 'INR', amountMinor: BigInt(amount) }],
        })),
      ),
    },
    platformAudit: { createMany: vi.fn(async ({ data }: { data: unknown }) => audit.push(data)) },
  }
  const setPrice = vi.fn(async (_op: string, key: string, _c: string, amount: number) => {
    prices.set(key, amount)
    return { plan_key: key, currency: 'INR', amount_minor: BigInt(amount) }
  })
  const db = {
    withGlobal: (fn: (t: typeof tx) => unknown) => fn(tx),
    system: { platformSetPlanPrice: setPrice },
  }
  return { svc: new PlatformPlansService(db as never), audit, setPrice }
}
const asOperator = <T>(fn: () => Promise<T>) =>
  requestContext.run({ correlationId: 'c1', platform: { operatorId: 'op-1' } } as never, fn)

describe('plan prices', () => {
  it('seeds the launch INR monthly prices', () => {
    expect(Object.fromEntries(PLAN_SEEDS.map((p) => [p.key, p.monthlyInrMinor]))).toEqual({
      STARTER: 89900,
      GROWTH: 129900,
      BUSINESS: 199900,
    })
  })

  it('validates the operator input', () => {
    expect(setPlanPriceSchema.safeParse({ currency: 'INR', amountMinor: 149900 }).success).toBe(
      true,
    )
    for (const bad of [
      { currency: 'USD', amountMinor: 149900 },
      { currency: 'INR', amountMinor: 50 },
      { currency: 'INR', amountMinor: 12.5 },
      { currency: 'INR', amountMinor: 149900, extra: 1 },
    ])
      expect(setPlanPriceSchema.safeParse(bad).success).toBe(false)
  })

  it('sets the price through the grant-checked function and audits it', async () => {
    const s = service()
    const plan = await asOperator(() =>
      s.svc.setPrice('GROWTH', { currency: 'INR', amountMinor: 149900 }),
    )
    expect(s.setPrice).toHaveBeenCalledWith('op-1', 'GROWTH', 'INR', 149900)
    expect(plan.monthly).toEqual({ currency: 'INR', amountMinor: 149900 })
    expect(s.audit).toEqual([
      expect.objectContaining({ operatorId: 'op-1', action: 'platform.plan_price_set' }),
    ])
  })

  it('refuses without an operator session and 404s an unknown plan', async () => {
    await expect(service().svc.list()).rejects.toMatchObject({ status: 403 })
    await expect(
      asOperator(() => service(false).svc.setPrice('NOPE', { currency: 'INR', amountMinor: 100 })),
    ).rejects.toMatchObject({ status: 404 })
  })
})
