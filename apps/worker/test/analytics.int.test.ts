import {
  AnalyticsEventsProcessor,
  AnalyticsRollupProcessor,
  AnalyticsService,
  addDays,
  dayIn,
  markDay,
} from '@fenwira/api/modules/analytics'
import { postTransaction } from '@fenwira/api/modules/billing'
import { type EntitlementSource } from '@fenwira/api/modules/entitlements'
import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
  statusWebhook,
} from '@fenwira/whatsapp/testing'
import { QueueRegistry } from '@fenwira/api/core'
import { QUEUES } from '@fenwira/queue'
import { type INestApplication } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chain, createFlow, keyword, text } from './support/automation'
import {
  campaignOf,
  campaignWorld,
  type CampaignWorld,
  draftCampaign,
  launch,
  metaId,
  seedContacts,
  waitFor,
} from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner } from './support/workspace'

/**
 * Phase 11 Step 2 (docs/ANALYTICS.md): the analytics projection reconciles with the
 * authoritative tables, never counts an event twice, heals late events, survives failures,
 * follows the workspace timezone and applies retention from entitlements.
 */
const SECRET = 'test-app-secret'
const ENV = { BILLING_ENFORCED: 'true' }
const ANALYTICS_TYPES = [
  'message.outbound.requested',
  'message.inbound.received',
  'message.status.changed',
  'conversation.opened',
  'conversation.assigned',
  'campaign.launched',
  'campaign.resumed',
  'campaign.completed',
  'automation.execution.finished',
]

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string
let w: CampaignWorld
let campaignId: string
let customers: string[]

const t = () => w.owner.tenantId
const rollups = () => worker.get(AnalyticsRollupProcessor)
const events = () => worker.get(AnalyticsEventsProcessor)
const get = (path: string) => w.owner.client.get(path).then((r) => r.body)
const retention = (days: number | null): EntitlementSource => ({
  enabled: async () => true,
  limit: async (_tx, _t, key) => (key === 'analytics_retention' ? days : null),
})
const setRetention = (days: number | null) => {
  rollups().entitlements.useSource(retention(days))
  api.get(AnalyticsService).entitlements.useSource(retention(days))
}

/** Waits until analytics recorded every subscribed event the workspace's outbox dispatched. */
async function settled(tenantId = t()) {
  await waitFor(
    () =>
      db.withTenant(tenantId, async (tx) => {
        const outbox = await tx.outboxEvent.count({
          where: { eventType: { in: ANALYTICS_TYPES } },
        })
        const recorded = await tx.analyticsEvent.count()
        const pending = await tx.outboxEvent.count({ where: { status: 'PENDING' } })
        return { outbox, recorded, pending }
      }),
    (s) => s.pending === 0 && s.recorded >= s.outbox,
    30_000,
  )
}

/** Authoritative figures straight from the source tables. */
const raw = (tenantId = t()) =>
  db.withTenant(tenantId, async (tx) => {
    const out = await tx.message.groupBy({
      by: ['status'],
      where: { direction: 'OUTBOUND' },
      _count: { _all: true },
    })
    const c = (s: string[]) =>
      out.filter((o) => s.includes(o.status)).reduce((a, o) => a + o._count._all, 0)
    const usage = await tx.usageEvent.aggregate({ _sum: { amountMinor: true, quantity: true } })
    const debits = await tx.walletTransaction.aggregate({
      where: { type: 'DEBIT', referenceType: 'message' },
      _sum: { amountMinor: true },
    })
    const recipients = await tx.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    })
    const executions = await tx.automationExecution.groupBy({
      by: ['status'],
      _count: { _all: true },
    })
    return {
      sent: c(['SENT', 'DELIVERED', 'READ']),
      delivered: c(['DELIVERED', 'READ']),
      read: c(['READ']),
      failed: c(['FAILED']),
      inbound: await tx.message.count({ where: { direction: 'INBOUND' } }),
      usageCharge: Number(usage._sum.amountMinor ?? 0n),
      usageMessages: usage._sum.quantity ?? 0,
      ledgerUsage: -Number(debits._sum.amountMinor ?? 0n),
      recipients: Object.fromEntries(recipients.map((r) => [r.status, r._count._all])),
      executions: Object.fromEntries(executions.map((e) => [e.status, e._count._all])),
    }
  })

async function customerWrites(from: string, body: string) {
  expect(
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text: body }),
    ),
  ).toBe(200)
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
    ANALYTICS_SETTLE_SECONDS: '0',
    ...ENV,
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
  // The tests drive rollups themselves; the every-minute pass would race their assertions.
  await worker.get(QueueRegistry).get(QUEUES.analyticsRollup).removeJobScheduler('analytics-rollup')
  mock.state.webhookTarget = {
    url: webhookUrl,
    appSecret: SECRET,
    statuses: ['sent', 'delivered'],
    delayMs: 20,
  }

  // A realistic day: a campaign (one recipient blocked → skipped), customers writing in, an agent
  // replying and resolving, and an automation answering a keyword.
  w = await campaignWorld(api, mock.url, 'analytics')
  await db.withTenant(t(), (tx) =>
    postTransaction(
      tx,
      t(),
      {
        type: 'CREDIT',
        amountMinor: 100_000n,
        reason: 'analytics test',
        idempotencyKey: `an-${metaId()}`,
      },
      { enforced: true, trialCreditMinor: 0, lowBalanceThresholdMinor: 100 },
    ),
  )
  const { tagId } = await seedContacts(db, t(), `an-${metaId()}`, [
    { name: 'A1' },
    { name: 'A2' },
    { name: 'A3' },
    { name: 'A4' },
    { name: 'Blocked', status: 'BLOCKED' },
  ])
  campaignId = (await draftCampaign(w, tagId)).id
  expect((await launch(w, campaignId)).status).toBe(200)
  await waitFor(
    () => campaignOf(w, campaignId),
    (c) => c.status === 'COMPLETED',
  )
  await createFlow(w.owner, 'Hours', chain(keyword('hours'), text('reply', 'We open at 9.')))
  customers = [0, 1, 2].map(() => `9198${String(Math.random()).slice(2, 10)}`)
  await customerWrites(customers[0]!, 'Hi, where is my order?')
  await customerWrites(customers[1]!, 'hours')
  const convo = await waitFor(
    () =>
      get('/conversations?view=all').then(
        (r) => r.data as Array<{ id: string; contact: { phoneE164: string } }>,
      ),
    (list) => list.some((x) => x.contact.phoneE164 === `+${customers[0]}`),
  )
  const c0 = convo.find((x) => x.contact.phoneE164 === `+${customers[0]}`)!
  await new Promise((r) => setTimeout(r, 1100)) // a measurable first-response time
  expect(
    (
      await w.owner.client.post(
        `/conversations/${c0.id}/messages`,
        { content: { type: 'TEXT', text: 'Let me check.' } },
        { 'Idempotency-Key': `r-${metaId()}` },
      )
    ).status,
  ).toBe(201)
  const resolved = await w.owner.client.post(`/conversations/${c0.id}/status`, {
    status: 'RESOLVED',
  })
  expect(resolved.status, resolved.text).toBeLessThan(300)
  await waitFor(
    () => raw(),
    (r) => (r.executions.COMPLETED ?? 0) >= 1 && r.sent + r.failed >= 6,
  )
  await settled()
  await rollups().rollupTenant(t())
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 11 Step 2: analytics reconciliation', () => {
  it('messaging, usage, campaign and automation figures equal the authoritative tables', async () => {
    await settled()
    await rollups().rollupTenant(t())
    const r = await raw()
    const m = await get('/analytics/messaging')
    expect(m.meta.freshness.status).toBe('READY')
    expect(m.meta.partial).toBe(true)
    expect(m.meta.timezone).toBe('Asia/Kolkata')
    expect({
      sent: m.kpis.sent.value,
      delivered: m.kpis.delivered.value,
      read: m.kpis.read.value,
      failed: m.kpis.failed.value,
      inbound: m.kpis.inbound.value,
    }).toEqual({
      sent: r.sent,
      delivered: r.delivered,
      read: r.read,
      failed: r.failed,
      inbound: r.inbound,
    })
    expect(m.kpis.deliveryRate).toMatchObject({ numerator: r.delivered, denominator: r.sent })
    expect(m.kpis.deliveryRate.value).toBeCloseTo(r.delivered / r.sent)
    const bySource = Object.fromEntries(
      m.byCategory.map((b: { key: string; values: { sent: number } }) => [b.key, b.values.sent]),
    )
    expect(bySource.UTILITY).toBeGreaterThanOrEqual(4) // the campaign's utility template

    const u = await get('/analytics/usage')
    expect(u.kpis.chargeMinor.value).toBe(r.usageCharge)
    expect(u.kpis.chargeMinor.value).toBe(r.ledgerUsage) // usage events reconcile with the ledger
    expect(u.kpis.billableMessages.value).toBe(r.usageMessages)
    expect(JSON.stringify(u)).not.toContain('provider') // P11-Q25 interim: no provider cost

    const c = await get('/analytics/campaigns')
    const row = c.campaigns.find((x: { campaignId: string }) => x.campaignId === campaignId)
    expect(row).toMatchObject({
      recipients: Object.values(r.recipients).reduce((a, b) => a + b, 0),
      skipped: r.recipients.SKIPPED ?? 0,
      failed: r.recipients.FAILED ?? 0,
      delivered: (r.recipients.DELIVERED ?? 0) + (r.recipients.READ ?? 0),
    })
    expect(row.skipped).toBe(1)
    expect(c.skipReasons.length).toBe(1)

    const a = await get('/analytics/automations')
    expect(a.kpis.executions.value).toBe(Object.values(r.executions).reduce((x, y) => x + y, 0))
    expect(a.kpis.completed.value).toBe(r.executions.COMPLETED ?? 0)
    expect(a.flows[0]).toMatchObject({ name: 'Hours', completed: r.executions.COMPLETED })
    // automation.execution.finished: emitted once per finished execution.
    const finished = await db.withTenant(t(), (tx) =>
      tx.outboxEvent.count({ where: { eventType: 'automation.execution.finished' } }),
    )
    expect(finished).toBe(r.executions.COMPLETED)
  })

  it('inbox: opens, first human reply and resolution per episode', async () => {
    const i = await get('/analytics/inbox')
    expect(i.kpis.opened.value).toBe(2) // two customers wrote in
    expect(i.kpis.newConversations.value).toBeGreaterThanOrEqual(2)
    expect(i.kpis.resolved.value).toBe(1)
    expect(i.kpis.firstResponses).toBe(1) // the automation reply to "hours" doesn't count
    expect(i.kpis.medianFirstResponseSeconds).toBeGreaterThanOrEqual(1)
    expect(i.kpis.medianResolutionSeconds).toBeGreaterThanOrEqual(1)
    expect(i.agents[0]).toMatchObject({ firstResponses: 1, resolved: 1 })
    expect(i.episodesSince).toBe(i.meta.today)
  })

  it('overview: KPIs, series, top campaigns and flows; money only with billing.read', async () => {
    const o = await get('/analytics/overview')
    const r = await raw()
    expect(o.kpis.sent.value).toBe(r.sent)
    expect(o.series.at(-1).values.sent).toBe(r.sent)
    expect(o.series).toHaveLength(30)
    expect(o.topCampaigns[0].campaignId).toBe(campaignId)
    expect(o.topFlows[0].name).toBe('Hours')
    expect(o.kpis.chargeMinor.value).toBe(r.usageCharge)
    const manager = await addMember(api, w.owner, 'MANAGER')
    const mo = (await manager.client.get('/analytics/overview')).body
    expect(mo.kpis.chargeMinor).toBeNull()
    expect((await manager.client.get('/analytics/usage')).status).toBe(403)
    const agent = await addMember(api, w.owner, 'AGENT')
    expect((await agent.client.get('/analytics/messaging')).status).toBe(403)
  })
})

describe('Phase 11 Step 2: deduplication, late events, retries and failures', () => {
  it('a redelivered event is recorded once and never changes the figures', async () => {
    const before = await get('/analytics/messaging')
    const row = await db.withTenant(t(), (tx) =>
      tx.outboxEvent.findFirstOrThrow({ where: { eventType: 'message.status.changed' } }),
    )
    const job = {
      data: {
        eventId: row.id,
        eventType: row.eventType,
        tenantId: row.tenantId,
        correlationId: null,
        occurredAt: row.createdAt.toISOString(),
        payload: row.payload,
      },
    } as unknown as Job
    // Two workers get the same job at once (retry after a crash), then a third redelivery.
    const results = await Promise.all([events().process(job), events().process(job)])
    expect(results).toEqual(['duplicate', 'duplicate'])
    expect(await events().process(job)).toBe('duplicate')
    const count = await db.withTenant(t(), (tx) =>
      tx.analyticsEvent.count({ where: { sourceEventId: row.id } }),
    )
    expect(count).toBe(1)
    await rollups().rollupTenant(t())
    expect((await get('/analytics/messaging')).kpis).toEqual(before.kpis)
  })

  it('late status events update the day they belong to; concurrent rollups agree', async () => {
    const m = await db.withTenant(t(), (tx) =>
      tx.message.findFirstOrThrow({
        where: { direction: 'OUTBOUND', status: 'DELIVERED', providerMessageId: { not: null } },
      }),
    )
    await deliverWebhook(
      webhookUrl,
      SECRET,
      statusWebhook(w.ids, { wamid: m.providerMessageId!, status: 'read' }),
    )
    await waitFor(
      () => db.withTenant(t(), (tx) => tx.message.findFirstOrThrow({ where: { id: m.id } })),
      (x) => x.status === 'READ',
    )
    await settled()
    await Promise.all([rollups().rollupTenant(t()), rollups().rollupTenant(t())])
    const r = await raw()
    const after = await get('/analytics/messaging')
    expect(after.kpis.read.value).toBe(r.read)
    expect(after.kpis.delivered.value).toBe(r.delivered)
  })

  it('a failed rollup is recorded (DEGRADED), keeps its work, and recovers', async () => {
    const day = dayIn(new Date(), 'Asia/Kolkata')
    await db.withTenant(t(), (tx) => markDay(tx, t(), day))
    await db.withTenant(t(), (tx) =>
      tx.tenant.update({ where: { id: t() }, data: { timezone: 'Mars/Olympus_Mons' } }),
    )
    expect((await rollups().rollupTenant(t())).status).toBe('failed')
    await db.withTenant(t(), (tx) =>
      tx.tenant.update({ where: { id: t() }, data: { timezone: 'Asia/Kolkata' } }),
    )
    const degraded = await get('/analytics/messaging')
    expect(degraded.meta.freshness.status).toBe('DEGRADED')
    expect(degraded.meta.freshness.pending).toBeGreaterThanOrEqual(1) // the mark survived
    expect((await rollups().rollupTenant(t())).status).toBe('ok')
    expect((await get('/analytics/messaging')).meta.freshness.status).toBe('READY')
  })

  it('the nightly heal finds no drift after normal operation, and corrects real drift', async () => {
    expect((await rollups().rollupTenant(t(), new Date(), 'heal')).corrections).toBe(0)
    // Simulate drift: a projection row altered behind the pipeline's back.
    const yesterday = addDays(dayIn(new Date(), 'Asia/Kolkata'), -1)
    await db.withTenant(
      t(),
      (tx) =>
        tx.$executeRaw`
        INSERT INTO analytics_daily_rollups (tenant_id, day, metric, dims_key, value)
        VALUES (${t()}::uuid, ${yesterday}::date, 'msg.out.sent', '', 99)
        ON CONFLICT (tenant_id, day, metric, dims_key) DO UPDATE SET value = 99`,
    )
    expect((await rollups().rollupTenant(t(), new Date(), 'heal')).corrections).toBe(1)
  })
})

describe('Phase 11 Step 2: time zones, retention and empty states', () => {
  it('buckets by the workspace timezone and rebuilds when it changes', async () => {
    const today = dayIn(new Date(), 'Asia/Kolkata')
    // 01:00 IST today = 19:30 UTC the previous calendar day.
    const [{ at }] = (await db.withTenant(
      t(),
      (tx) =>
        tx.$queryRaw<Array<{ at: Date }>>`
        SELECT ((${today}::date::timestamp + interval '1 hour') AT TIME ZONE 'Asia/Kolkata') AS at`,
    )) as [{ at: Date }]
    const msg = await db.withTenant(t(), (tx) =>
      tx.message.findFirstOrThrow({
        where: { direction: 'INBOUND' },
        orderBy: { createdAt: 'asc' },
      }),
    )
    const original = msg.createdAt
    const inboundOn = async (day: string) =>
      (await get(`/analytics/messaging?from=${day}&to=${day}`)).kpis.inbound.value as number
    const baseline = await inboundOn(today)
    await db.withTenant(t(), async (tx) => {
      await tx.message.update({ where: { id: msg.id }, data: { createdAt: at } })
      await markDay(tx, t(), dayIn(original, 'Asia/Kolkata'))
      await markDay(tx, t(), today)
    })
    await rollups().rollupTenant(t())
    expect(await inboundOn(today)).toBe(baseline) // still "today" in Kolkata
    const utcDay = dayIn(at, 'UTC')
    expect(utcDay).toBe(addDays(today, -1))

    await db.withTenant(t(), (tx) =>
      tx.tenant.update({ where: { id: t() }, data: { timezone: 'UTC' } }),
    )
    await rollups().rollupTenant(t()) // timezone changed → full rebuild in UTC days
    await rollups().rollupTenant(t())
    const utc = await get(`/analytics/messaging?from=${utcDay}&to=${utcDay}`)
    expect(utc.meta.timezone).toBe('UTC')
    expect(utc.kpis.inbound.value).toBeGreaterThanOrEqual(1)

    await db.withTenant(t(), async (tx) => {
      await tx.tenant.update({ where: { id: t() }, data: { timezone: 'Asia/Kolkata' } })
      await tx.message.update({ where: { id: msg.id }, data: { createdAt: original } })
    })
    await rollups().rollupTenant(t())
    await rollups().rollupTenant(t())
    expect(await inboundOn(today)).toBe(baseline)
  })

  it('retention (P11-D15) comes from entitlements, touches only analytics, and can grow back', async () => {
    const today = dayIn(new Date(), 'Asia/Kolkata')
    const old = addDays(today, -10)
    const msg = await db.withTenant(t(), (tx) =>
      tx.message.findFirstOrThrow({ where: { direction: 'OUTBOUND', source: 'CAMPAIGN' } }),
    )
    const original = msg.createdAt
    const [{ at }] = (await db.withTenant(
      t(),
      (tx) =>
        tx.$queryRaw<Array<{ at: Date }>>`
        SELECT ((${old}::date::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kolkata') AS at`,
    )) as [{ at: Date }]
    await db.withTenant(t(), async (tx) => {
      await tx.message.update({ where: { id: msg.id }, data: { createdAt: at } })
      await markDay(tx, t(), old)
    })
    // An analytics event from 10 days ago (the log is append-only; it arrives as a late event).
    await db.withTenant(
      t(),
      (tx) =>
        tx.$executeRaw`
        INSERT INTO analytics_events (id, tenant_id, source_event_id, event_type, occurred_at)
        VALUES (gen_random_uuid(), ${t()}::uuid, gen_random_uuid(), 'conversation.assigned', ${at})`,
    )
    await rollups().rollupTenant(t())
    const accepted = async (day: string) =>
      (await get(`/analytics/messaging?from=${day}&to=${day}`)).kpis.sent.value as number
    expect(await accepted(old)).toBe(1)

    setRetention(3)
    try {
      await rollups().retainTenant(t())
      const clamped = await get(`/analytics/messaging?from=${old}&to=${today}`)
      expect(clamped.meta.retention).toMatchObject({ days: 3, clamped: true })
      expect(clamped.meta.range.from).toBe(addDays(today, -2))
      const left = await db.withTenant(t(), async (tx) => ({
        rollups: await tx.analyticsDailyRollup.count({
          where: { day: new Date(`${old}T00:00:00Z`) },
        }),
        events: await tx.analyticsEvent.count({
          where: { occurredAt: { lt: new Date(Date.now() - 5 * 86_400_000) } },
        }),
        message: await tx.message.count({ where: { id: msg.id } }),
      }))
      expect(left).toEqual({ rollups: 0, events: 0, message: 1 }) // source data untouched

      // Retention grows (a plan change): the days now covered are rebuilt from source data.
      setRetention(30)
      await rollups().retainTenant(t())
      await rollups().rollupTenant(t())
      expect(await accepted(old)).toBe(1)
    } finally {
      setRetention(null)
      await db.withTenant(t(), async (tx) => {
        await tx.message.update({ where: { id: msg.id }, data: { createdAt: original } })
        await markDay(tx, t(), old)
        await markDay(tx, t(), dayIn(original, 'Asia/Kolkata'))
      })
      await rollups().rollupTenant(t())
    }
  })

  it('no data yet, zero activity and tenant isolation', async () => {
    const other = await createOwner(api, 'an-empty')
    const first = (await other.client.get('/analytics/messaging')).body
    expect(first.meta.freshness.status).toBe('NOT_STARTED')
    await rollups().rollupTenant(other.tenantId)
    const empty = (await other.client.get('/analytics/messaging')).body
    expect(empty.meta.freshness.status).toBe('READY')
    expect(empty.kpis.sent).toEqual({ value: 0, previous: 0 })
    // Zero denominators: no rate, never 0 %.
    expect(empty.kpis.deliveryRate).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
      previous: null,
    })
    expect(empty.kpis.failureRate.value).toBeNull()
    // Another workspace never sees these figures.
    expect((await other.client.get('/analytics/campaigns')).body.campaigns).toEqual([])
    expect((await other.client.get('/analytics/inbox')).body.kpis.opened.value).toBe(0)
  })

  it('validates the range contract', async () => {
    const today = dayIn(new Date(), 'Asia/Kolkata')
    expect(
      (await w.owner.client.get(`/analytics/messaging?from=${today}&to=${addDays(today, -1)}`))
        .status,
    ).toBe(400)
    expect(
      (await w.owner.client.get(`/analytics/messaging?from=${addDays(today, -400)}`)).status,
    ).toBe(400)
    const future = await get(`/analytics/messaging?to=${addDays(today, 5)}`)
    expect(future.meta.range.to).toBe(today) // clamped to today
    const noCompare = await get('/analytics/messaging?compare=false')
    expect(noCompare.meta.previous).toBeNull()
    expect(noCompare.kpis.sent.previous).toBeNull()
  })
})

describe('Contact → Campaigns', () => {
  it('lists the contact’s campaign recipient rows from the authoritative relation', async () => {
    const recipient = await db.withTenant(t(), (tx) =>
      tx.campaignRecipient.findFirstOrThrow({ where: { campaignId, status: { not: 'SKIPPED' } } }),
    )
    const res = await w.owner.client.get(`/contacts/${recipient.contactId}/campaigns`)
    expect(res.status, res.text).toBe(200)
    expect(res.body.data).toEqual([
      expect.objectContaining({
        campaignId,
        recipientStatus: recipient.status,
        campaignStatus: 'COMPLETED',
        sentAt: recipient.sentAt?.toISOString() ?? null,
      }),
    ])
    const other = await createOwner(api, 'an-contact-other')
    expect((await other.client.get(`/contacts/${recipient.contactId}/campaigns`)).status).toBe(404)
  })
})
