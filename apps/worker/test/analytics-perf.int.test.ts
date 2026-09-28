import { AnalyticsRollupProcessor, addDays, dayIn } from '@fenwira/api/modules/analytics'
import { Database } from '@fenwira/database'
import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { campaignWorld, type CampaignWorld, metaId, seedContacts } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'

/**
 * Analytics performance probe (not part of the regular suite: PERF=1). Seeds one workspace with
 * PERF_MESSAGES messages spread over 90 days, then measures the backfill, one busy day's
 * recompute, and the analytics API over 30, 90 and 365 days. Reports timings; asserts only that
 * the day query uses the (tenant_id, created_at) index.
 */
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 300_000)
const DAYS = 90
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let w: CampaignWorld

const log = (line: string) => process.stdout.write(`${line}\n`)
const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6
const t = () => w.owner.tenantId

beforeAll(async () => {
  if (!process.env.PERF) return
  mock = await startMetaMock(0)
  api = await bootApi({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_DEV_CONNECT: 'true' })
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, ANALYTICS_SETTLE_SECONDS: '0' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
  w = await campaignWorld(api, mock.url, 'an-perf')
  const { contactIds } = await seedContacts(
    db,
    t(),
    `perf-${metaId()}`,
    Array.from({ length: 1000 }, () => ({})),
  )
  const started = process.hrtime.bigint()
  await db.withTenant(t(), async (tx) => {
    await tx.$executeRaw`
      INSERT INTO conversations (id, tenant_id, contact_id, phone_number_id, status, created_at, updated_at)
      SELECT gen_random_uuid(), ${t()}::uuid, c, ${w.phoneId}::uuid, 'OPEN', now() - interval '90 days', now()
      FROM unnest(${contactIds}::uuid[]) AS c`
  })
  // Outbound (status mix) and inbound messages spread uniformly over the last 90 days, in
  // transactions small enough for the interactive-transaction timeout.
  const CHUNK = 25_000
  for (let chunk = 0; chunk < MESSAGES; chunk += CHUNK)
    await db.withTenant(t(), async (tx) => {
      await tx.$executeRaw`
        WITH cv AS (
          SELECT array_agg(id ORDER BY id) AS ids, array_agg(contact_id ORDER BY id) AS contacts
          FROM conversations WHERE tenant_id = ${t()}::uuid)
        INSERT INTO messages (id, tenant_id, conversation_id, contact_id, direction, type, status, source,
                              content, created_at, updated_at)
        SELECT gen_random_uuid(), ${t()}::uuid, cv.ids[1 + g % 1000], cv.contacts[1 + g % 1000],
               CASE WHEN g % 4 = 0 THEN 'INBOUND' ELSE 'OUTBOUND' END::message_direction, 'TEXT',
               (CASE WHEN g % 4 = 0 THEN 'RECEIVED'
                     ELSE (ARRAY['SENT','DELIVERED','READ','READ','FAILED'])[1 + g % 5] END)::message_status,
               (CASE WHEN g % 4 = 0 THEN 'CUSTOMER' ELSE (ARRAY['INBOX','CAMPAIGN','AUTOMATION'])[1 + g % 3] END)::message_source,
               '{"type":"TEXT","text":"x"}'::jsonb,
               now() - random() * ${DAYS - 1} * interval '1 day', now()
        FROM generate_series(${chunk + 1}, ${Math.min(chunk + CHUNK, MESSAGES)}) AS g, cv`
    })
  log(
    `[perf] seeded ${MESSAGES} messages over ${DAYS} days in ${ms(started).toFixed(0)} ms`,
  )
}, 900_000)

afterAll(async () => {
  if (!process.env.PERF) return
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe.skipIf(!process.env.PERF)('analytics performance', () => {
  it('backfill, one day recompute and API ranges stay bounded', async () => {
    const rollups = worker.get(AnalyticsRollupProcessor)
    let started = process.hrtime.bigint()
    let passes = 0
    let days = 0
    for (;;) {
      const r = await rollups.rollupTenant(t())
      passes++
      days += r.days
      const pending = await db.withTenant(t(), (tx) => tx.analyticsDirty.count())
      if (pending === 0 || passes > 20) break
    }
    log(
      `[perf] backfill: ${days} days in ${passes} passes, ${ms(started).toFixed(0)} ms (${(ms(started) / days).toFixed(1)} ms/day)`,
    )

    const today = dayIn(new Date(), 'Asia/Kolkata')
    const busy = addDays(today, -1)
    const plans = await db.withTenant(t(), (tx) =>
      tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT count(*) FROM messages
         WHERE tenant_id = '${t()}'::uuid AND created_at >= now() - interval '1 day' AND created_at < now()`,
      ),
    )
    log(`[perf] day scan plan:\n${plans.map((p) => p['QUERY PLAN']).join('\n')}`)
    expect(plans.map((p) => p['QUERY PLAN']).join('\n')).toMatch(
      /messages_tenant_id_created_at_idx/,
    )

    started = process.hrtime.bigint()
    await db.withTenant(t(), async (tx) => {
      await tx.$executeRaw`
        INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
        VALUES (${t()}::uuid, 'day', ${busy}, now() - interval '1 minute')
        ON CONFLICT (tenant_id, scope, key) DO UPDATE SET marked_at = EXCLUDED.marked_at`
    })
    await rollups.rollupTenant(t())
    log(
      `[perf] one pass recomputing yesterday (~${Math.round(MESSAGES / DAYS)} messages) + today: ${ms(started).toFixed(0)} ms`,
    )

    for (const [view, span] of [
      ['messaging', 30],
      ['messaging', 90],
      ['messaging', 365],
      ['overview', 90],
      ['inbox', 90],
      ['automations', 90],
      ['campaigns', 90],
    ] as const) {
      const from = addDays(today, -(span - 1))
      started = process.hrtime.bigint()
      const res = await w.owner.client.get(`/analytics/${view}?from=${from}&to=${today}`)
      expect(res.status).toBe(200)
      log(`[perf] GET /analytics/${view} (${span} days): ${ms(started).toFixed(0)} ms`)
    }
    const m = (await w.owner.client.get(`/analytics/messaging?from=${addDays(today, -89)}`)).body
    const raw = await db.withTenant(t(), (tx) =>
      tx.message.count({ where: { direction: 'OUTBOUND', status: 'FAILED' } }),
    )
    expect(m.kpis.failed.value).toBe(raw) // reconciles at volume too
  }, 900_000)
})
