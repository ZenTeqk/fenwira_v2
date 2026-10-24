import { describe, expect, it, vi } from 'vitest'
import { PriceBookGuard } from '../src/modules/billing/price-book.guard'

const guard = (enforced: boolean, nodeEnv: string, placeholders: number) => {
  const count = vi.fn(async () => placeholders)
  const db = { withGlobal: (fn: (tx: unknown) => unknown) => fn({ priceBookEntry: { count } }) }
  return { g: new PriceBookGuard(db as never, { enforced } as never, { nodeEnv } as never), count }
}

describe('price book startup guard', () => {
  it('refuses production startup with BILLING_ENFORCED while prices are unapproved', async () => {
    await expect(guard(true, 'production', 4).g.onApplicationBootstrap()).rejects.toThrow(
      /BILLING_ENFORCED=true but 4 active price book entries are unapproved/,
    )
  })

  it('starts when enforcement is off, prices are approved, or outside production', async () => {
    const off = guard(false, 'production', 4)
    await expect(off.g.onApplicationBootstrap()).resolves.toBeUndefined()
    expect(off.count).not.toHaveBeenCalled()
    await expect(guard(true, 'production', 0).g.onApplicationBootstrap()).resolves.toBeUndefined()
    await expect(guard(true, 'test', 4).g.onApplicationBootstrap()).resolves.toBeUndefined()
  })
})
