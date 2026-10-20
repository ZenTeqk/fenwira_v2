import {
  AnalyticsRollupProcessor,
  dayIn,
  recordEvent,
  recomputeDay,
} from '@fenwira/api/modules/analytics'
import { lockWallet, postTransaction } from '@fenwira/api/modules/billing'
import { EntitlementsService } from '@fenwira/api/modules/entitlements'
import { uuidv7 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

let db: Database
const traversalIds: string[] = []
beforeAll(() => {
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
})
afterAll(async () => {
  for (const tenantId of traversalIds)
    await db.withTenant(tenantId, (tx) =>
      tx.analyticsTenantState.deleteMany({ where: { tenantId } }),
    )
  await db?.disconnect()
})
const log = { setContext() {}, error() {} }
const metric = { set() {}, inc() {}, observe() {} }
const metrics = new Proxy({}, { get: () => metric })
const processor = () =>
  new AnalyticsRollupProcessor(
    db,
    { settleSeconds: 0 },
    new EntitlementsService(),
    {} as never,
    metrics as never,
    log as never,
  )
async function tenant(ownerUserId?: string) {
  const tenantId = uuidv7(),
    userId = ownerUserId ?? uuidv7()
  if (!ownerUserId)
    await db.withGlobal((tx) =>
      tx.user.create({
        data: {
          id: userId,
          name: 'Analytics recovery',
          email: `${userId}@analytics-recovery.test`,
          passwordHash: 'unused',
        },
      }),
    )
  await db.withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: {
        id: tenantId,
        name: 'Analytics recovery',
        slug: tenantId,
        ownerUserId: userId,
        timezone: 'Asia/Kolkata',
      },
    }),
  )
  return { tenantId, userId }
}

it('pass, heal and retention traverse more than 500 continuously eligible PostgreSQL tenants', async () => {
  const first = await tenant(),
    ids = [first.tenantId],
    now = new Date()
  for (let i = 1; i < 501; i++) ids.push((await tenant(first.userId)).tenantId)
  for (const tenantId of ids)
    await db.withTenant(tenantId, (tx) =>
      tx.analyticsTenantState.create({ data: { tenantId, lastEventAt: now } }),
    )
  traversalIds.push(...ids)
  const p = processor()
  // Exercise real selector SQL and processor page traversal; existing analytics.int.test.ts
  // exercises the expensive per-tenant rollup/reconciliation logic against source records.
  const rollup = vi.spyOn(p, 'rollupTenant').mockResolvedValue({
    days: 0,
    campaigns: 0,
    changed: 0,
    corrections: 0,
    lagSeconds: 0,
    status: 'ok',
  })
  const retention = vi.spyOn(p, 'retainTenant').mockResolvedValue(0)
  await p.pass(now)
  for (const id of ids)
    expect(rollup.mock.calls.filter(([tenantId]) => tenantId === id)).toHaveLength(1)
  rollup.mockClear()
  await p.heal(now)
  for (const id of ids)
    expect(rollup.mock.calls.filter(([tenantId]) => tenantId === id)).toHaveLength(1)
  await p.retention(now)
  for (const id of ids)
    expect(retention.mock.calls.filter(([tenantId]) => tenantId === id)).toHaveLength(1)
  // A new processor starts traversal from the beginning after a worker/job restart.
  const restarted = processor(),
    again = vi.spyOn(restarted, 'rollupTenant').mockResolvedValue({
      days: 0,
      campaigns: 0,
      changed: 0,
      corrections: 0,
      lagSeconds: 0,
      status: 'ok',
    })
  await restarted.pass(now)
  for (const id of ids)
    expect(again.mock.calls.filter(([tenantId]) => tenantId === id)).toHaveLength(1)
}, 90_000)

async function applyPosting(tenantId: string, occurredAt = new Date().toISOString()) {
  return db.withTenant(tenantId, async (tx) => {
    const event = await tx.outboxEvent.findFirstOrThrow({
      where: { eventType: 'billing.transaction_posted' },
    })
    const consumed = {
      eventId: event.id,
      tenantId,
      eventType: 'billing.transaction_posted' as const,
      payload: event.payload,
      occurredAt,
      correlationId: null,
    }
    const input = consumed as Parameters<typeof recordEvent>[2]
    expect(await recordEvent(tx, tenantId, input)).toBe('recorded')
    expect(await recordEvent(tx, tenantId, input)).toBe('duplicate')
    return { event, input }
  })
}

it('promotional credit wakes a quiet workspace, replays once and reconciles without a message', async () => {
  const { tenantId } = await tenant(),
    other = await tenant(),
    old = new Date(Date.now() - 7 * 86_400_000)
  await db.withTenant(tenantId, (tx) =>
    tx.analyticsTenantState.create({
      data: {
        tenantId,
        timezone: 'Asia/Kolkata',
        backfilledAt: old,
        lastEventAt: old,
        lastRollupAt: old,
      },
    }),
  )
  const credit = {
    type: 'CREDIT' as const,
    amountMinor: 1000n,
    fundType: 'PROMOTIONAL' as const,
    reason: 'Quiet promotional credit',
    idempotencyKey: 'quiet-promo',
  }
  await db.withTenant(tenantId, (tx) => postTransaction(tx, tenantId, credit))
  await db.withTenant(tenantId, (tx) => postTransaction(tx, tenantId, credit))
  expect(
    await db.withTenant(tenantId, (tx) =>
      tx.outboxEvent.count({ where: { eventType: 'billing.transaction_posted' } }),
    ),
  ).toBe(1)
  const { input } = await applyPosting(tenantId)
  expect(
    await db.withTenant(other.tenantId, (tx) =>
      recordEvent(tx, other.tenantId, { ...input, tenantId: other.tenantId }),
    ),
  ).toBe('ignored')
  let after: string | null = null,
    found = false
  for (;;) {
    const page = await db.system.tenantsWithActivity(new Date(Date.now() - 15 * 60_000), 500, after)
    if (!page.length) break
    if (page.includes(tenantId)) found = true
    after = page[page.length - 1]!
  }
  expect(found).toBe(true)
  const result = await processor().rollupTenant(tenantId)
  expect(result.status).toBe('ok')
  await db.withTenant(tenantId, async (tx) => {
    const row = await tx.analyticsDailyRollup.findFirstOrThrow({
      where: { metric: 'usage.promo_credit_minor', dimsKey: 'cur:INR' },
    })
    expect(row.value).toBe(1000n)
    expect(await tx.analyticsDirty.count()).toBe(0)
    expect(await tx.message.count()).toBe(0)
    expect(
      (await tx.analyticsTenantState.findUniqueOrThrow({ where: { tenantId } })).lastRollupAt,
    ).not.toBeNull()
  })
  expect(await db.withTenant(other.tenantId, (tx) => tx.analyticsDailyRollup.count())).toBe(0)
})

it.each([
  ['2026-10-20T18:00:00Z', '2026-10-20'],
  ['2026-10-20T23:45:00Z', '2026-10-21'],
])('late processing uses ledger time %s and workspace boundary %s', async (at, day) => {
  const { tenantId } = await tenant()
  await db.withTenant(tenantId, async (tx) => {
    const wallet = await lockWallet(tx, tenantId)
    // Immutable seed record with an explicit historical posting timestamp; no UPDATE to ledger.
    const row = await tx.walletTransaction.create({
      data: {
        tenantId,
        walletId: wallet.id,
        type: 'CREDIT',
        amountMinor: 10n,
        balanceAfterMinor: 10n,
        reason: 'Historical fixture',
        fundType: 'PROMOTIONAL',
        idempotencyKey: 'historical',
        createdAt: new Date(at),
      },
    })
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'billing.transaction_posted',
        aggregateId: row.id,
        aggregateType: 'wallet_transaction',
        payload: { transactionId: row.id },
      },
    })
  })
  await applyPosting(tenantId, '2026-10-25T00:00:00Z')
  await db.withTenant(tenantId, async (tx) => {
    expect((await tx.analyticsDirty.findMany()).map((row) => row.key)).toEqual([day])
    await recomputeDay(tx, tenantId, day, 'Asia/Kolkata')
    expect(
      (
        await tx.analyticsDailyRollup.findFirstOrThrow({
          where: { metric: 'usage.promo_credit_minor' },
        })
      ).value,
    ).toBe(10n)
    expect(dayIn(new Date(at), 'Asia/Kolkata')).toBe(day)
  })
})

it('one-time initial promotional trial credit also emits one ledger invalidation', async () => {
  const { tenantId } = await tenant(),
    billing = { enforced: true, trialCreditMinor: 50, lowBalanceThresholdMinor: 100 }
  await db.withTenant(tenantId, (tx) => lockWallet(tx, tenantId, billing))
  await db.withTenant(tenantId, (tx) => lockWallet(tx, tenantId, billing))
  await db.withTenant(tenantId, async (tx) => {
    expect(await tx.outboxEvent.count({ where: { eventType: 'billing.transaction_posted' } })).toBe(
      1,
    )
    expect(await tx.walletTransaction.count()).toBe(1)
  })
  await applyPosting(tenantId)
})
