import {
  ledgerFigures,
  lockWallet,
  postTransaction,
  releaseReservation,
  reserveForMessage,
  settleReservation,
} from '@fenwira/api/modules/billing'
import { uuidv7 } from '@fenwira/config'
import { Database, type TenantTx } from '@fenwira/database'
import { afterAll, beforeAll, expect, it } from 'vitest'

let db: Database
beforeAll(() => {
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 16 })
})
afterAll(async () => db?.disconnect())

async function fixture() {
  const tenantId = uuidv7(),
    userId = uuidv7(),
    messageId = uuidv7()
  await db.withGlobal((tx) =>
    tx.user.create({
      data: {
        id: userId,
        email: `${userId}@wallet-race.test`,
        name: 'Wallet race',
        passwordHash: 'unused',
      },
    }),
  )
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, name: 'Wallet race', slug: tenantId, ownerUserId: userId },
    })
    await postTransaction(tx, tenantId, {
      type: 'CREDIT',
      amountMinor: 1000n,
      reason: 'Isolated test credit',
      idempotencyKey: 'initial-credit',
    })
    await reserveForMessage(tx, tenantId, { messageId, category: 'UTILITY', country: null })
  })
  return { tenantId, messageId }
}
const settle = (tx: TenantTx, tenantId: string, messageId: string) =>
  settleReservation(tx, tenantId, {
    messageId,
    category: 'UTILITY',
    country: null,
    pricing: { billable: true, category: 'UTILITY' },
  })
async function reconcile(tenantId: string) {
  return db.withTenant(tenantId, async (tx) => {
    const w = await tx.wallet.findUniqueOrThrow({ where: { tenantId } })
    const figures = await ledgerFigures(tx, w.id)
    expect(figures.balanceMinor).toBe(figures.ledgerMinor)
    expect(figures.reservedMinor).toBe(figures.activeHoldsMinor)
    expect(figures.reservedMinor).toBeGreaterThanOrEqual(0n)
    return {
      w,
      debits: await tx.walletTransaction.count({ where: { type: 'DEBIT' } }),
      usage: await tx.usageEvent.count(),
    }
  })
}

// Force the original READ COMMITTED window without sleeps: A holds the wallet while B either
// reads ACTIVE (old bug), or attempts the wallet lock (fixed). A commits before B continues.
it('rechecks ACTIVE after waiting on a competing wallet transaction', async () => {
  const { tenantId, messageId } = await fixture()
  let locked!: () => void, attempted!: () => void, committed!: () => void
  const hasLock = new Promise<void>((r) => {
    locked = r
  })
  const hasAttempt = new Promise<void>((r) => {
    attempted = r
  })
  const firstCommitted = new Promise<void>((r) => {
    committed = r
  })
  const first = db
    .withTenant(tenantId, async (tx) => {
      await lockWallet(tx, tenantId)
      locked()
      await hasAttempt
      return settle(tx, tenantId, messageId)
    })
    .then((r) => {
      committed()
      return r
    })
  await hasLock
  const second = db.withTenant(tenantId, (tx) =>
    settle(
      new Proxy(tx, {
        get(target, key, receiver) {
          if (key === '$queryRaw')
            return (strings: TemplateStringsArray, ...values: unknown[]) => {
              if (strings.join('').includes('wallets')) attempted()
              return target.$queryRaw(strings, ...values)
            }
          if (key === 'walletReservation')
            return new Proxy(target.walletReservation, {
              get(delegate, method, delegateReceiver) {
                if (method === 'findFirst')
                  return async (args: Parameters<typeof delegate.findFirst>[0]) => {
                    const snapshot = await delegate.findFirst(args)
                    attempted()
                    await firstCommitted
                    return snapshot
                  }
                return Reflect.get(delegate, method, delegateReceiver)
              },
            })
          return Reflect.get(target, key, receiver)
        },
      }),
      tenantId,
      messageId,
    ),
  )
  expect(await Promise.all([first, second])).toEqual(['settled', 'none'])
  expect(await reconcile(tenantId)).toMatchObject({ debits: 1, usage: 1, w: { reservedMinor: 0n } })
})

it.each([2, 12])('%i simultaneous settlements post one debit and close one hold', async (n) => {
  const { tenantId, messageId } = await fixture()
  const results = await Promise.all(
    Array.from({ length: n }, () =>
      db.withTenant(tenantId, (tx) => settle(tx, tenantId, messageId)),
    ),
  )
  expect(results.filter((r) => r === 'settled')).toHaveLength(1)
  expect(await reconcile(tenantId)).toMatchObject({ debits: 1, usage: 1, w: { reservedMinor: 0n } })
})

it('settlement racing cancellation/release has one terminal financial outcome', async () => {
  for (let i = 0; i < 6; i++) {
    const { tenantId, messageId } = await fixture()
    await Promise.all([
      db.withTenant(tenantId, (tx) => settle(tx, tenantId, messageId)),
      db.withTenant(tenantId, (tx) => releaseReservation(tx, tenantId, messageId, 'cancelled')),
    ])
    const r = await reconcile(tenantId)
    const hold = await db.withTenant(tenantId, (tx) =>
      tx.walletReservation.findUniqueOrThrow({ where: { messageId } }),
    )
    expect(r.w.reservedMinor).toBe(0n)
    expect(r.debits).toBe(hold.status === 'SETTLED' ? 1 : 0)
    expect(r.usage).toBe(r.debits)
  }
})

it('identical requests and worker retry after commit are deterministic no-ops', async () => {
  const { tenantId, messageId } = await fixture()
  expect(await db.withTenant(tenantId, (tx) => settle(tx, tenantId, messageId))).toBe('settled')
  for (let i = 0; i < 3; i++) {
    expect(await db.withTenant(tenantId, (tx) => settle(tx, tenantId, messageId))).toBe('none')
    expect(
      await db.withTenant(tenantId, (tx) => releaseReservation(tx, tenantId, messageId, 'retry')),
    ).toBe(false)
  }
  expect(await reconcile(tenantId)).toMatchObject({ debits: 1, usage: 1 })
})

it('rollback restores reservation, ledger, balance and usage before retry', async () => {
  const { tenantId, messageId } = await fixture()
  await expect(
    db.withTenant(tenantId, async (tx) => {
      await settle(tx, tenantId, messageId)
      throw new Error('injected failure after posting')
    }),
  ).rejects.toThrow('injected failure')
  expect(await reconcile(tenantId)).toMatchObject({
    debits: 0,
    usage: 0,
    w: { balanceMinor: 1000n },
  })
  expect(await db.withTenant(tenantId, (tx) => settle(tx, tenantId, messageId))).toBe('settled')
  expect(await reconcile(tenantId)).toMatchObject({ debits: 1, usage: 1, w: { reservedMinor: 0n } })
})

it('foreign reservation IDs cannot be settled or released through another tenant', async () => {
  const a = await fixture(),
    b = await fixture()
  expect(await db.withTenant(b.tenantId, (tx) => settle(tx, b.tenantId, a.messageId))).toBe('none')
  expect(
    await db.withTenant(b.tenantId, (tx) =>
      releaseReservation(tx, b.tenantId, a.messageId, 'foreign'),
    ),
  ).toBe(false)
  for (const t of [a, b])
    expect(await reconcile(t.tenantId)).toMatchObject({
      debits: 0,
      usage: 0,
      w: { balanceMinor: 1000n },
    })
})

it('concurrent identical ledger credits replay instead of raising a unique violation', async () => {
  const { tenantId } = await fixture()
  const ids = await Promise.all(
    Array.from({ length: 8 }, () =>
      db.withTenant(tenantId, (tx) =>
        postTransaction(tx, tenantId, {
          type: 'CREDIT',
          amountMinor: 100n,
          reason: 'Retry top-up',
          idempotencyKey: 'same-top-up',
        }),
      ),
    ),
  )
  expect(new Set(ids).size).toBe(1)
  expect((await reconcile(tenantId)).w.balanceMinor).toBe(1100n)
})
