import {
  BillingMaintenanceProcessor,
  ledgerFigures,
  postTransaction,
} from '@fenwira/api/modules/billing'
import { MessagingService } from '@fenwira/api/modules/messaging'
import { NotificationsDispatchProcessor } from '@fenwira/api/modules/notifications'
import { Database } from '@fenwira/database'
import { startMetaMock, type MetaMockState } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { campaignWorld, metaId, phoneNo, waitFor } from './support/campaigns'
import { bootApi, bootWorker, emailCount, linkFromEmail } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * Phase 11 Step 1 (docs/plans/PHASE_11_PLAN.md §2.1–2.4): wallet state from the configured
 * threshold (P11-D12), one event per crossing, low-balance notifications, stale-reservation
 * recovery, the daily ledger check, and the transactions API. Threshold 100 paise here; UTILITY
 * costs 13 paise in the seeded price book.
 */
const THRESHOLD = 100
const OPS = 'ops-alerts@fenwira.test'
const SUPPORT_URL = 'https://billing.fenwira.test/top-up'
const ENV = {
  BILLING_ENFORCED: 'true',
  BILLING_LOW_BALANCE_THRESHOLD_MINOR: String(THRESHOLD),
  BILLING_SUPPORT_URL: SUPPORT_URL,
  BILLING_SUPPORT_EMAIL: 'billing@fenwira.test',
}
const PLATFORM = { enforced: true, trialCreditMinor: 0, lowBalanceThresholdMinor: THRESHOLD }
const GRACE_MS = 361 * 60_000
/** Polls until `load` returns something other than null. */
const until = <T>(load: () => Promise<T | null>) => waitFor(load, (v) => v !== null) as Promise<T>

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database

const post = (tenantId: string, amount: number, type: 'CREDIT' | 'DEBIT' = 'CREDIT') =>
  db.withTenant(tenantId, (tx) =>
    postTransaction(
      tx,
      tenantId,
      {
        type,
        amountMinor: BigInt(type === 'DEBIT' ? -amount : amount),
        reason: type === 'DEBIT' ? 'test debit' : 'test top-up',
        idempotencyKey: `t:${metaId()}`,
      },
      PLATFORM,
    ),
  )
const walletEvents = (tenantId: string) =>
  db.withTenant(tenantId, (tx) =>
    tx.outboxEvent.findMany({
      where: { eventType: { in: ['wallet.low_balance', 'wallet.recovered', 'wallet.funded'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  )
const walletNotifications = (tenantId: string) =>
  db.withTenant(tenantId, (tx) =>
    tx.notification.findMany({
      where: { type: { in: ['wallet.low_balance', 'wallet.recovered'] } },
      orderBy: { createdAt: 'asc' },
    }),
  )
/** The outbox row as the relay would deliver it. */
const asJob = (row: {
  id: string
  tenantId: string | null
  eventType: string
  payload: unknown
  createdAt: Date
}) =>
  ({
    data: {
      eventId: row.id,
      eventType: row.eventType,
      tenantId: row.tenantId,
      correlationId: null,
      occurredAt: row.createdAt.toISOString(),
      payload: row.payload,
    },
  }) as unknown as Job
async function assertLedger(tenantId: string) {
  await db.withTenant(tenantId, async (tx) => {
    const w = await tx.wallet.findUniqueOrThrow({ where: { tenantId } })
    const f = await ledgerFigures(tx, w.id)
    expect(f.balanceMinor).toBe(f.ledgerMinor)
    expect(f.reservedMinor).toBe(f.activeHoldsMinor)
  })
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_DEV_CONNECT: 'true',
    ...ENV,
  })
  worker = await bootWorker({
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
    OPS_ALERT_EMAIL: OPS,
    ...ENV,
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 11 Step 1: wallet state (P11-D12)', () => {
  it('computes the state from the configured threshold and emits one event per crossing', async () => {
    const owner = await createOwner(api, 'ws-state')
    const t = owner.tenantId
    const state = async () => (await owner.client.get('/billing/wallet')).body.data

    // A new wallet records its state silently (no event for "never funded").
    expect(await state()).toMatchObject({
      state: 'INSUFFICIENT_FUNDS',
      availableMinor: 0,
      lowBalanceThresholdMinor: THRESHOLD,
      spentThisMonthMinor: 0,
    })
    expect(await walletEvents(t)).toHaveLength(0)

    await post(t, THRESHOLD) // first funding, exactly at the threshold: LOW
    expect((await state()).state).toBe('LOW_BALANCE')
    await post(t, 1) // above: NORMAL
    expect((await state()).state).toBe('NORMAL')
    await post(t, 1, 'DEBIT') // back at the threshold
    await post(t, 50, 'DEBIT') // still LOW: no event
    await post(t, 25, 'DEBIT') // still LOW: no event
    expect((await state()).state).toBe('LOW_BALANCE')
    await post(t, 25, 'DEBIT') // 0: INSUFFICIENT
    expect(await state()).toMatchObject({
      state: 'INSUFFICIENT_FUNDS',
      availableMinor: 0,
      spentThisMonthMinor: 101,
    })

    const events = await walletEvents(t)
    expect(events.map((e) => [e.eventType, e.payload])).toEqual([
      // P11-D21: initial funding is its own event, never a "restored" balance.
      ['wallet.funded', expect.objectContaining({ to: 'LOW_BALANCE', availableMinor: 100 })],
      ['wallet.recovered', expect.objectContaining({ from: 'LOW_BALANCE', availableMinor: 101 })],
      [
        'wallet.low_balance',
        expect.objectContaining({ from: 'NORMAL', to: 'LOW_BALANCE', availableMinor: 100 }),
      ],
      [
        'wallet.low_balance',
        expect.objectContaining({
          from: 'LOW_BALANCE',
          to: 'INSUFFICIENT_FUNDS',
          availableMinor: 0,
        }),
      ],
    ])
    expect((await owner.client.get('/workspace/status')).body.data).toEqual({
      wallet: { state: 'INSUFFICIENT_FUNDS', currency: 'INR', availableMinor: 0 },
    })
    await assertLedger(t)
  })

  it('FREE workspaces are NOT_ENFORCED and their crossings notify nobody', async () => {
    const owner = await createOwner(api, 'ws-free')
    const t = owner.tenantId
    await db.withTenant(t, (tx) =>
      tx.tenant.update({ where: { id: t }, data: { billingMode: 'FREE' } }),
    )
    await owner.client.get('/billing/wallet')
    await post(t, 500)
    await post(t, 450, 'DEBIT')
    expect((await owner.client.get('/billing/wallet')).body.data).toMatchObject({
      state: 'NOT_ENFORCED',
      enforced: false,
      availableMinor: 50,
    })
    const [low] = (await walletEvents(t)).filter((e) => e.eventType === 'wallet.low_balance')
    expect(low).toBeTruthy()
    const dispatch = worker.get(NotificationsDispatchProcessor)
    await expect(dispatch.process(asJob(low!))).resolves.toBe('not-enforced')
    expect(await walletNotifications(t)).toHaveLength(0)
  })
})

describe('P11-D21: first funding is not a recovery', () => {
  it('first credit → wallet.funded without notifications; later recoveries are wallet.recovered', async () => {
    const owner = await createOwner(api, 'ws-funded')
    const t = owner.tenantId
    const dispatch = worker.get(NotificationsDispatchProcessor)
    expect((await owner.client.get('/billing/wallet')).body.data.state).toBe('INSUFFICIENT_FUNDS')
    await post(t, 500) // unfunded → NORMAL
    let events = await walletEvents(t)
    expect(events.map((e) => [e.eventType, (e.payload as { to?: string }).to])).toEqual([
      ['wallet.funded', 'NORMAL'],
    ])
    await expect(dispatch.process(asJob(events[0]!))).resolves.toBe('funded')
    // Replaying the same ledger post records nothing new (idempotent under the wallet lock).
    for (let i = 0; i < 2; i++)
      await db.withTenant(t, (tx) =>
        postTransaction(
          tx,
          t,
          { type: 'CREDIT', amountMinor: 500n, reason: 'x', idempotencyKey: `dup-${t}` },
          PLATFORM,
        ),
      )
    await post(t, 1000, 'DEBIT') // → 0: INSUFFICIENT
    // Let the notification land before the top-up supersedes the crossing.
    await until(async () => ((await walletNotifications(t)).length === 1 ? true : null))
    await post(t, 300) // INSUFFICIENT → NORMAL: a real recovery
    events = await walletEvents(t)
    expect(events.map((e) => e.eventType)).toEqual([
      'wallet.funded',
      'wallet.low_balance',
      'wallet.recovered',
    ])
    expect(events[2]!.payload).toMatchObject({ from: 'INSUFFICIENT_FUNDS' })
    // The first funding never produced a "restored" notification.
    const notes = await until(async () => {
      const n = await walletNotifications(t)
      return n.length >= 2 ? n : null
    })
    expect(notes.map((n) => n.title)).toEqual([
      'Wallet is out of credits',
      'Wallet balance restored',
    ])
  })
})

describe('P11-D20: billing contact', () => {
  it('comes from configuration and is shown by the API and the email', async () => {
    const owner = await createOwner(api, 'ws-support')
    expect((await owner.client.get('/billing/wallet')).body.data.support).toEqual({
      email: 'billing@fenwira.test',
      url: SUPPORT_URL,
    })
    await post(owner.tenantId, 40) // first funding, already low → low-balance email
    const link = await linkFromEmail(owner.email, 'billing.fenwira.test')
    expect(link).toContain(SUPPORT_URL)
  })
})

describe('Phase 11 Step 1: low-balance notifications', () => {
  let owner: Member
  let admin: Member
  let agent: Member

  beforeAll(async () => {
    owner = await createOwner(api, 'ws-notify')
    admin = await addMember(api, owner, 'ADMIN')
    agent = await addMember(api, owner, 'AGENT')
    await owner.client.get('/billing/wallet')
  })

  it('notifies members with billing.read (bell + email) once per crossing; never agents', async () => {
    const t = owner.tenantId
    const before = {
      owner: await emailCount(owner.email),
      admin: await emailCount(admin.email),
      agent: await emailCount(agent.email),
    }
    await post(t, 60) // INSUFFICIENT → LOW
    const notes = await until(async () => {
      const n = await walletNotifications(t)
      return n.length === 2 ? n : null
    })
    expect(notes.map((n) => [n.title, n.severity, n.link])).toEqual([
      ['Wallet balance is low', 'WARNING', '/billing/wallet'],
      ['Wallet balance is low', 'WARNING', '/billing/wallet'],
    ])
    await until(async () =>
      (await emailCount(owner.email)) === before.owner + 1 &&
      (await emailCount(admin.email)) === before.admin + 1
        ? true
        : null,
    )
    expect(await emailCount(agent.email)).toBe(before.agent)
    const bell = (await owner.client.get('/notifications')).body.data as Array<{ title: string }>
    expect(bell.some((n) => n.title === 'Wallet balance is low')).toBe(true)

    // Redelivery of the same event: nothing new.
    const [event] = await walletEvents(t)
    const dispatch = worker.get(NotificationsDispatchProcessor)
    await expect(dispatch.process(asJob(event!))).resolves.toBe('notified:0')
    expect(await walletNotifications(t)).toHaveLength(2)

    // A top-up supersedes the old crossing: replaying it now notifies nobody.
    await post(t, 1000)
    await until(async () => ((await walletNotifications(t)).length === 4 ? true : null))
    await expect(dispatch.process(asJob(event!))).resolves.toBe('superseded')
    expect((await walletNotifications(t)).slice(2).map((n) => [n.title, n.severity])).toEqual([
      ['Wallet balance restored', 'INFO'],
      ['Wallet balance restored', 'INFO'],
    ])
  })

  it('workspace status: every member sees the state, amounts need billing.read', async () => {
    expect((await agent.client.get('/workspace/status')).body.data.wallet).toEqual({
      state: 'NORMAL',
      currency: 'INR',
      availableMinor: null,
    })
    expect((await admin.client.get('/workspace/status')).body.data.wallet).toMatchObject({
      state: 'NORMAL',
      availableMinor: 1060,
    })
    expect((await agent.client.get('/billing/wallet')).status).toBe(403)
    expect((await agent.client.get('/billing/wallet/transactions')).status).toBe(403)
    expect((await agent.client.post('/billing/wallet/transactions/export', {})).status).toBe(403)
  })

  it('lists, filters and pages transactions; exports CSV with an audit entry', async () => {
    const t = owner.tenantId
    await post(t, 30, 'DEBIT')
    const all = await owner.client.get('/billing/wallet/transactions?limit=2')
    expect(all.status, all.text).toBe(200)
    expect(all.body.data).toHaveLength(2)
    expect(all.body.page.hasMore).toBe(true)
    expect(all.body.data[0]).toMatchObject({
      type: 'DEBIT',
      fundType: 'PAID',
      amountMinor: -30,
      balanceAfterMinor: 1030,
      currency: 'INR',
      reason: 'test debit',
    })
    const next = await owner.client.get(
      `/billing/wallet/transactions?limit=2&cursor=${all.body.page.nextCursor}`,
    )
    expect(next.body.data).toHaveLength(1)
    expect(next.body.page.hasMore).toBe(false)
    const debits = await owner.client.get('/billing/wallet/transactions?type=DEBIT')
    expect(debits.body.data.map((d: { amountMinor: number }) => d.amountMinor)).toEqual([-30])
    const today = new Date().toISOString().slice(0, 10)
    const ranged = await owner.client.get(`/billing/wallet/transactions?from=${today}&to=${today}`)
    expect(ranged.body.data).toHaveLength(3)
    const future = await owner.client.get('/billing/wallet/transactions?from=2999-01-01')
    expect(future.body.data).toHaveLength(0)

    const csv = await owner.client.post('/billing/wallet/transactions/export', { type: 'DEBIT' })
    expect(csv.status, csv.text).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    const lines = csv.text.trim().split(/\r?\n/)
    expect(lines[0]).toBe(
      'date,type,fund_type,reason,reference_type,reference_id,amount,balance_after,currency,transaction_id',
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(',DEBIT,PAID,test debit,,,-0.30,10.30,INR,')
    const audit = await owner.client.get('/audit-logs?action=billing.transactions.exported')
    expect(audit.body.data[0]).toMatchObject({ action: 'billing.transactions.exported' })

    // Another workspace never sees these rows.
    const other = await createOwner(api, 'ws-other')
    expect((await other.client.get('/billing/wallet/transactions')).body.data).toHaveLength(0)
  })
})

describe('Phase 11 Step 1: reservation recovery and ledger check', () => {
  it('recovers stale reservations once: settles recorded billable pricing, releases the rest', async () => {
    const w = await campaignWorld(api, mock.url, 'recover')
    const t = w.owner.tenantId
    await post(t, 10_000)
    const messaging = worker.get(MessagingService)
    const sent: string[] = []
    for (let i = 0; i < 4; i++) {
      const m = await messaging.send({
        tenantId: t,
        target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
        content: {
          type: 'TEMPLATE',
          templateVersionId: w.utility.versionId,
          variables: { body: ['A', `#${i}`] },
        },
        source: 'API',
        idempotencyKey: `rec-${metaId()}`,
      })
      sent.push(m.id)
    }
    // No status webhooks are configured on the mock: the reservations stay ACTIVE.
    await until(async () => {
      const n = await db.withTenant(t, (tx) =>
        tx.message.count({ where: { id: { in: sent }, providerMessageId: { not: null } } }),
      )
      return n === 4 ? true : null
    })
    const [failed, priced, unpriced, fresh] = sent as [string, string, string, string]
    await db.withTenant(t, async (tx) => {
      // A failure recorded without its status event, a billable status whose billing job was
      // lost (the event is recorded, already dispatched), and a delivery Meta never priced.
      await tx.message.update({ where: { id: failed }, data: { status: 'FAILED' } })
      await tx.message.update({ where: { id: priced }, data: { status: 'SENT' } })
      await tx.outboxEvent.create({
        data: {
          tenantId: t,
          eventType: 'message.status.changed',
          aggregateType: 'message',
          aggregateId: priced,
          payload: {
            messageId: priced,
            from: 'SENDING',
            to: 'SENT',
            pricing: { billable: true, category: 'utility' },
          },
          status: 'DISPATCHED',
          dispatchedAt: new Date(),
        },
      })
      await tx.message.update({ where: { id: unpriced }, data: { status: 'DELIVERED' } })
      await tx.message.update({ where: { id: fresh }, data: { status: 'FAILED' } })
    })
    const reservations = () =>
      db.withTenant(t, (tx) =>
        tx.walletReservation.findMany({
          where: { messageId: { in: sent } },
          select: { messageId: true, status: true, reason: true },
        }),
      )
    const statusOf = async (id: string) => (await reservations()).find((r) => r.messageId === id)

    const maintenance = worker.get(BillingMaintenanceProcessor)
    // Within the grace period nothing is touched.
    await maintenance.recoverStale(new Date())
    expect((await reservations()).every((r) => r.status === 'ACTIVE')).toBe(true)

    const before = await emailCount(OPS)
    await maintenance.recoverStale(new Date(Date.now() + GRACE_MS))
    expect(await statusOf(failed)).toMatchObject({ status: 'RELEASED' })
    expect(await statusOf(priced)).toMatchObject({ status: 'SETTLED' })
    expect(await statusOf(unpriced)).toMatchObject({
      status: 'RELEASED',
      reason: 'recovered: no pricing received',
    })
    expect(await statusOf(fresh)).toMatchObject({ status: 'RELEASED' })
    await until(async () => ((await emailCount(OPS)) > before ? true : null))

    // Replay: nothing changes, one usage debit for the priced message only.
    await maintenance.recoverStale(new Date(Date.now() + GRACE_MS))
    const debits = await db.withTenant(t, (tx) =>
      tx.walletTransaction.findMany({ where: { type: 'DEBIT', referenceType: 'message' } }),
    )
    expect(debits.map((d) => [d.referenceId, d.amountMinor])).toEqual([[priced, -13n]])
    const wallet = (await w.owner.client.get('/billing/wallet')).body.data
    expect(wallet).toMatchObject({ reservedMinor: 0, balanceMinor: 10_000 - 13 })
    await assertLedger(t)
  })

  it('the daily ledger check reports drift and never corrects it', async () => {
    const owner = await createOwner(api, 'ws-ledger')
    const t = owner.tenantId
    await post(t, 700)
    const walletId = await db.withTenant(t, async (tx) => {
      const w = await tx.wallet.findUniqueOrThrow({ where: { tenantId: t } })
      await tx.$executeRaw`UPDATE wallets SET reserved_minor = reserved_minor + 7 WHERE id = ${w.id}::uuid`
      return w.id
    })
    const maintenance = worker.get(BillingMaintenanceProcessor)
    const before = await emailCount(OPS)
    expect(await maintenance.checkLedger()).toBeGreaterThanOrEqual(1)
    expect((await db.system.walletLedgerDrift(1000)).map((d) => d.walletId)).toContain(walletId)
    await until(async () => ((await emailCount(OPS)) > before ? true : null))
    // Not corrected: the drift is still there for a person to investigate.
    const f = await db.withTenant(t, (tx) => ledgerFigures(tx, walletId))
    expect(f).toMatchObject({ reservedMinor: 7n, activeHoldsMinor: 0n, balanceMinor: 700n })
    await db.withTenant(
      t,
      (tx) => tx.$executeRaw`UPDATE wallets SET reserved_minor = 0 WHERE id = ${walletId}::uuid`,
    )
    expect((await db.system.walletLedgerDrift(1000)).map((d) => d.walletId)).not.toContain(walletId)
  })
})
