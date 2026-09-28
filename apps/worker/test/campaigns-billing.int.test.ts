import { lockWallet, postTransaction } from '@fenwira/api/modules/billing'
import { CampaignDispatchProcessor } from '@fenwira/api/modules/campaigns'
import { MessagingService } from '@fenwira/api/modules/messaging'
import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  campaignOf,
  campaignWorld,
  type CampaignWorld,
  draftCampaign,
  launch,
  metaId,
  phoneNo,
  seedContacts,
  sendsTo,
  statsOf,
  waitFor,
} from './support/campaigns'
import { bootApi, bootWorker, emailCount } from './support/harness'

/**
 * B3/B4 with BILLING_ENFORCED=true: billable sends reserve atomically; concurrent workers never
 * overspend; settlement, release and the insufficient-funds pause/resume. UTILITY costs 13 paise
 * in the seeded price book.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string
const ENV = { BILLING_ENFORCED: 'true' }
/** Operations alerts (O1) for this run only. */
const OPS = `ops-campaigns-${Date.now()}@fenwira.test`

const world = (label: string) => campaignWorld(api, mock.url, label)
/** Any tenant context works for the global price book (no RLS). */
const metaIdTenant = () => '00000000-0000-7000-8000-000000000000'
const credit = (tenantId: string, paise: number) =>
  db.withTenant(tenantId, (tx) =>
    postTransaction(tx, tenantId, {
      type: 'CREDIT',
      amountMinor: BigInt(paise),
      reason: 'test top-up',
      idempotencyKey: `test-credit:${metaId()}`,
    }),
  )
const wallet = (w: CampaignWorld) => w.owner.client.get('/billing/wallet').then((r) => r.body.data)
/** Ledger invariants: balance = Σ ledger; reserved = Σ ACTIVE reservations. */
async function assertLedger(tenantId: string) {
  await db.withTenant(tenantId, async (tx) => {
    const w = await tx.wallet.findUniqueOrThrow({ where: { tenantId } })
    const sum = await tx.walletTransaction.aggregate({
      where: { walletId: w.id },
      _sum: { amountMinor: true },
    })
    const held = await tx.walletReservation.aggregate({
      where: { walletId: w.id, status: 'ACTIVE' },
      _sum: { amountMinor: true },
    })
    expect(w.balanceMinor).toBe(sum._sum.amountMinor ?? 0n)
    expect(w.reservedMinor).toBe(held._sum.amountMinor ?? 0n)
  })
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
    ...ENV,
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  worker = await bootWorker({
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
    CAMPAIGN_BATCH_SIZE: '5',
    OPS_ALERT_EMAIL: OPS,
    ...ENV,
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
  mock.state.webhookTarget = {
    url: webhookUrl,
    appSecret: SECRET,
    statuses: ['sent', 'delivered'],
    delayMs: 30,
  }
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 9: wallet reservations (B4) in campaigns', () => {
  it('runs out of funds → PAUSED_INSUFFICIENT_FUNDS; resume refused until topped up; then completes', async () => {
    const w = await world('bill-funds')
    await credit(w.owner.tenantId, 50) // 3 × 13 = 39 fit; the 4th doesn't
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `funds-${metaId()}`,
      Array.from({ length: 8 }, (_, i) => ({ name: `P${i}` })),
    )
    const c = await draftCampaign(w, tagId)
    const est = (await w.owner.client.post(`/campaigns/${c.id}/estimate`)).body.data
    expect(est).toMatchObject({
      billingEnforced: true,
      estimatedCostMinor: 8 * 13,
      availableFundsMinor: 50,
    })
    expect(est.warnings.map((x: { code: string }) => x.code)).toContain('LOW_BALANCE')
    await launch(w, c.id)
    const paused = await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'PAUSED_INSUFFICIENT_FUNDS',
    )
    expect(paused.status).toBe('PAUSED_INSUFFICIENT_FUNDS')
    // Operators make top-ups (P11-D13), so they are alerted.
    await waitFor(
      () => emailCount(OPS),
      (n) => n >= 1,
    )
    // Processed recipients are kept; the rest wait, unsent.
    const s = await waitFor(
      () => statsOf(w, c.id),
      (x) => x.delivered === 3,
    )
    expect(s).toMatchObject({ total: 8, delivered: 3, pending: 5, failed: 0 })
    // Settled: 3 debits at the actual price; nothing held.
    await waitFor(
      () => wallet(w),
      (x) => x.reservedMinor === 0,
    )
    expect(await wallet(w)).toMatchObject({
      balanceMinor: 50 - 39,
      availableMinor: 11,
      enforced: true,
    })
    await assertLedger(w.owner.tenantId)

    // Resume needs the next recipient's cost (13) available.
    const refused = await w.owner.client.post(`/campaigns/${c.id}/resume`)
    expect([refused.status, refused.body.error.code]).toEqual([422, 'INSUFFICIENT_BALANCE'])
    await credit(w.owner.tenantId, 1000)
    expect((await w.owner.client.post(`/campaigns/${c.id}/resume`)).body.data.status).toBe(
      'RUNNING',
    )
    await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'COMPLETED',
    )
    await waitFor(
      () => statsOf(w, c.id),
      (x) => x.delivered === 8,
    )
    await waitFor(
      () => wallet(w),
      (x) => x.reservedMinor === 0,
    )
    expect((await wallet(w)).balanceMinor).toBe(1050 - 8 * 13)
    expect(
      sendsTo(mock.state, w.ids.phoneNumberId).filter(
        (x) => (x.payload.template as { name: string } | undefined)?.name === 'order_update',
      ),
    ).toHaveLength(8)
    await assertLedger(w.owner.tenantId)
  })

  it('concurrent workers never reserve the same funds (no overspend)', async () => {
    const w = await world('bill-race')
    await credit(w.owner.tenantId, 13 * 10) // exactly 10 messages
    const messaging = worker.get(MessagingService)
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        messaging.send({
          tenantId: w.owner.tenantId,
          target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
          content: {
            type: 'TEMPLATE',
            templateVersionId: w.utility.versionId,
            variables: { body: ['A', `#${i}`] },
          },
          source: 'API',
          idempotencyKey: `race-${i}-${metaId()}`,
        }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' && (r.reason as { code?: string }).code === 'INSUFFICIENT_BALANCE',
    )
    expect(ok).toHaveLength(10)
    expect(refused).toHaveLength(20)
    const wl = await wallet(w)
    expect(wl.balanceMinor + wl.creditLimitMinor - wl.reservedMinor).toBeGreaterThanOrEqual(0)
    await assertLedger(w.owner.tenantId)
  })

  it('a failed send releases its reservation; duplicate pricing webhooks settle once', async () => {
    const w = await world('bill-release')
    await credit(w.owner.tenantId, 100)
    await fetch(`${mock.url}/__mock/fail`, {
      method: 'POST',
      body: JSON.stringify({
        pathContains: `${w.ids.phoneNumberId}/messages`,
        method: 'POST',
        status: 400,
        code: 131026,
        times: 1,
      }),
    })
    const messaging = worker.get(MessagingService)
    const failed = await messaging.send({
      tenantId: w.owner.tenantId,
      target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
      content: {
        type: 'TEMPLATE',
        templateVersionId: w.utility.versionId,
        variables: { body: ['A', '#1'] },
      },
      source: 'API',
      idempotencyKey: `rel-${metaId()}`,
    })
    const reservation = (id: string) =>
      db.withTenant(w.owner.tenantId, (tx) =>
        tx.walletReservation.findFirst({ where: { messageId: id } }),
      )
    await waitFor(
      () => reservation(failed.id),
      (r) => r?.status === 'RELEASED',
    )
    expect((await wallet(w)).balanceMinor).toBe(100) // nothing charged

    const ok = await messaging.send({
      tenantId: w.owner.tenantId,
      target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
      content: {
        type: 'TEMPLATE',
        templateVersionId: w.utility.versionId,
        variables: { body: ['B', '#2'] },
      },
      source: 'API',
      idempotencyKey: `set-${metaId()}`,
    })
    await waitFor(
      () => reservation(ok.id),
      (r) => r?.status === 'SETTLED',
    )
    const debits = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.walletTransaction.count({ where: { type: 'DEBIT', referenceId: ok.id } }),
    )
    expect(debits).toBe(1) // 'sent' and 'delivered' both carry pricing; settled once
    expect((await wallet(w)).balanceMinor).toBe(100 - 13)
    await assertLedger(w.owner.tenantId)
  })

  it('inbound messages and status updates keep flowing with an empty wallet', async () => {
    const w = await world('bill-inbound')
    const from = `9197${String(Math.random()).slice(2, 10)}`
    const status = await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(w.ids, {
        from,
        wamid: `wamid.${metaId()}`,
        text: 'Hello with no credits',
      }),
    )
    expect(status).toBe(200)
    const convo = await waitFor(
      () =>
        w.owner.client
          .get('/conversations?view=all')
          .then((r) => r.body.data as Array<{ contact: { phoneE164: string } }>),
      (list) => list.some((x) => x.contact.phoneE164 === `+${from}`),
    )
    expect(convo.length).toBeGreaterThan(0)
    // A billable send is refused with the typed error; a free-form reply inside the window isn't billable.
    const c = convo.find((x) => x.contact.phoneE164 === `+${from}`) as unknown as { id: string }
    const template = await w.owner.client.post(
      `/conversations/${c.id}/messages`,
      {
        content: {
          type: 'TEMPLATE',
          templateVersionId: w.utility.versionId,
          variables: { body: ['A', '#1'] },
        },
      },
      { 'Idempotency-Key': `t-${metaId()}` },
    )
    expect([template.status, template.body.error.code]).toEqual([422, 'INSUFFICIENT_BALANCE'])
    const text = await w.owner.client.post(
      `/conversations/${c.id}/messages`,
      { content: { type: 'TEXT', text: 'Happy to help!' } },
      { 'Idempotency-Key': `x-${metaId()}` },
    )
    expect(text.status, text.text).toBe(201)
  })

  it('billing modes (P9-D1): FREE is never enforced; TRIAL gets its trial credit once; PREPAID starts empty', async () => {
    const messaging = worker.get(MessagingService)
    const send = (w: CampaignWorld) =>
      messaging.send({
        tenantId: w.owner.tenantId,
        target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
        content: {
          type: 'TEMPLATE',
          templateVersionId: w.utility.versionId,
          variables: { body: ['A', '#1'] },
        },
        source: 'API',
        idempotencyKey: `mode-${metaId()}`,
      })
    const setMode = (w: CampaignWorld, mode: 'FREE' | 'TRIAL' | 'PREPAID') =>
      db.withTenant(w.owner.tenantId, (tx) =>
        tx.tenant.update({ where: { id: w.owner.tenantId }, data: { billingMode: mode } }),
      )

    // FREE: enforcement off for this tenant even with the platform switch on; wallet untouched.
    const free = await world('bill-free')
    await setMode(free, 'FREE')
    await expect(send(free)).resolves.toMatchObject({ status: 'CREATED' })
    expect(await wallet(free)).toMatchObject({
      enforced: false,
      billingMode: 'FREE',
      reservedMinor: 0,
    })

    // PREPAID with an empty wallet: refused.
    const prepaid = await world('bill-prepaid')
    await setMode(prepaid, 'PREPAID')
    await expect(send(prepaid)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })

    // TRIAL: the configured trial credit is granted once, when the wallet is first created.
    const trial = await world('bill-trial')
    const platform = { enforced: true, trialCreditMinor: 500, lowBalanceThresholdMinor: 10_000 }
    for (let i = 0; i < 3; i++)
      await db.withTenant(trial.owner.tenantId, (tx) =>
        lockWallet(tx, trial.owner.tenantId, platform),
      )
    const credits = await db.withTenant(trial.owner.tenantId, (tx) =>
      tx.walletTransaction.findMany({ where: { type: 'CREDIT' } }),
    )
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({
      amountMinor: 500n,
      reason: 'Trial credits',
      referenceType: 'promotion',
    })
    await expect(send(trial)).resolves.toMatchObject({ status: 'CREATED' })
    expect(await wallet(trial)).toMatchObject({ billingMode: 'TRIAL', enforced: true })
    await assertLedger(trial.owner.tenantId)
  })

  it('price book entries are labelled development placeholders (P9-D2)', async () => {
    const rows = await db.withTenant(metaIdTenant(), (tx) =>
      tx.priceBookEntry.findMany({ where: { country: null } }),
    )
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.every((r) => r.isPlaceholder && /placeholder/i.test(r.note ?? ''))).toBe(true)
  })

  it('recovery after a worker crash while funds are short keeps state consistent', async () => {
    const w = await world('bill-recover')
    await credit(w.owner.tenantId, 26)
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `rec-${metaId()}`,
      Array.from({ length: 4 }, (_, i) => ({ name: `R${i}` })),
    )
    const c = await draftCampaign(w, tagId)
    await launch(w, c.id)
    await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'PAUSED_INSUFFICIENT_FUNDS',
    )
    await worker.close()
    worker = await bootWorker({
      META_GRAPH_BASE_URL: mock.url,
      WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
      CAMPAIGN_BATCH_SIZE: '5',
      ...ENV,
    })
    await worker.get(CampaignDispatchProcessor).recover() // paused campaigns are not re-driven
    expect((await campaignOf(w, c.id)).status).toBe('PAUSED_INSUFFICIENT_FUNDS')
    await waitFor(
      () => wallet(w),
      (x) => x.reservedMinor === 0,
    )
    await assertLedger(w.owner.tenantId)
  })
})
