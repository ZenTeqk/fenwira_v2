import { BillingMaintenanceProcessor, NO_BILLING } from '@fenwira/api/modules/billing'
import { uuidv7 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { afterAll, beforeAll, expect, it } from 'vitest'

let db: Database
beforeAll(() => {
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
})
afterAll(async () => db?.disconnect())
const tick = () =>
  new BillingMaintenanceProcessor(
    db,
    NO_BILLING,
    { entitlements: { enforced: true } } as never,
    {} as never,
    {} as never,
    { subscriptionTransitions: { inc() {} } } as never,
    { setContext() {}, error() {} } as never,
  )

it('all 501 due workspaces receive notices and expiry, including the last page, without duplicates', async () => {
  const userId = uuidv7(),
    now = new Date(),
    ids: string[] = []
  await db.withGlobal((tx) =>
    tx.user.create({
      data: {
        id: userId,
        email: `${userId}@scheduler.test`,
        name: 'Scheduler',
        passwordHash: 'unused',
      },
    }),
  )
  for (let i = 0; i < 501; i++) {
    const tenantId = uuidv7()
    ids.push(tenantId)
    await db.withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: 'Scheduler fixture', slug: tenantId, ownerUserId: userId },
      })
      await tx.membership.create({ data: { tenantId, userId, role: 'OWNER', status: 'ACTIVE' } })
      await tx.subscription.create({
        data: {
          tenantId,
          status: 'TRIALING',
          trialEndsAt: new Date(now.getTime() + 2 * 86_400_000),
        },
      })
    })
  }
  ids.sort()
  // A terminal transition sorts behind the 500 rows that stay due after their warnings.
  const last = ids[500]!
  await db.withTenant(last, (tx) =>
    tx.subscription.update({
      where: { tenantId: last },
      data: { trialEndsAt: new Date(now.getTime() - 1) },
    }),
  )
  await tick().tickSubscriptions(now)
  expect(
    (
      await db.withTenant(last, (tx) =>
        tx.subscription.findUniqueOrThrow({ where: { tenantId: last } }),
      )
    ).status,
  ).toBe('EXPIRED')
  // Concurrent schedulers and a fresh instance simulate duplicate delivery and job restart.
  await Promise.all([tick().tickSubscriptions(now), tick().tickSubscriptions(now)])
  for (const tenantId of ids) {
    await db.withTenant(tenantId, async (tx) => {
      const row = await tx.subscription.findUniqueOrThrow({ where: { tenantId } })
      expect(row.noticesSent).toEqual(tenantId === last ? [] : ['T-3'])
      expect(
        await tx.notification.count({ where: { userId, type: 'subscription.lifecycle' } }),
      ).toBe(1)
    })
  }
  const expiry = new Date(now.getTime() + 3 * 86_400_000)
  await tick().tickSubscriptions(expiry)
  for (const tenantId of ids)
    expect(
      (
        await db.withTenant(tenantId, (tx) =>
          tx.subscription.findUniqueOrThrow({ where: { tenantId } }),
        )
      ).status,
    ).toBe('EXPIRED')
}, 120_000)

it('keyset traversal remains stable when due rows are deleted or inserted between pages', async () => {
  const userId = uuidv7(),
    ids: string[] = [],
    now = new Date()
  await db.withGlobal((tx) =>
    tx.user.create({
      data: { id: userId, email: `${userId}@cursor.test`, name: 'Cursor', passwordHash: 'unused' },
    }),
  )
  const add = async () => {
    const tenantId = uuidv7()
    ids.push(tenantId)
    await db.withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: 'Cursor', slug: tenantId, ownerUserId: userId },
      })
      await tx.subscription.create({ data: { tenantId, status: 'TRIALING', trialEndsAt: now } })
    })
    return tenantId
  }
  for (let i = 0; i < 4; i++) await add()
  const first = await db.system.subscriptionsDue(now, 2)
  const removed = ids[3]!
  await db.withTenant(removed, (tx) => tx.subscription.delete({ where: { tenantId: removed } }))
  const inserted = await add()
  const seen = [...first]
  let after = first[first.length - 1] ?? null
  for (;;) {
    const page = await db.system.subscriptionsDue(now, 2, after)
    if (!page.length) break
    expect(page.every((id) => !after || id > after)).toBe(true)
    seen.push(...page)
    after = page[page.length - 1]!
  }
  expect(new Set(seen).size).toBe(seen.length)
  expect(seen).toContain(inserted)
  expect(seen).not.toContain(removed)
  for (const id of ids.filter((id) => id !== removed)) expect(seen).toContain(id)
})
