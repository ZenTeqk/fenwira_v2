import { CampaignDispatchProcessor } from '@fenwira/api/modules/campaigns'
import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  type MetaMockState,
  startMetaMock,
  statusWebhook,
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
  recipientsOf,
  seedContacts,
  sendsTo,
  statsOf,
  waitFor,
} from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'

/**
 * Phase 9 acceptance (docs/prompts/PHASE_09_CAMPAIGNS.md) against the in-process meta-mock. Billing
 * enforcement is off here; campaigns-billing.int.test.ts covers reservations and insufficient funds.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string
const WORKER_ENV = { WHATSAPP_OUTBOUND_BACKOFF_MS: '20', CAMPAIGN_BATCH_SIZE: '10' }

const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const world = (label: string) => campaignWorld(api, mock.url, label)
const statuses = (s: Array<'sent' | 'delivered' | 'read'>) => {
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: s, delayMs: 30 }
}
const finished = (w: CampaignWorld, id: string, status = 'COMPLETED', timeoutMs = 60_000) =>
  waitFor(
    () => campaignOf(w, id),
    (c) => c.status === status,
    timeoutMs,
  )

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, ...WORKER_ENV })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  statuses(['sent', 'delivered', 'read'])
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 9: campaign lifecycle', { timeout: 120_000 }, () => {
  it('estimate → launch → snapshot → MessagingService → webhooks → COMPLETED with stats', async () => {
    const w = await world('cmp-happy')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `happy-${metaId()}`, [
      { name: 'Asha Rao', orderNo: '#A1' },
      { name: 'Ravi Kumar', orderNo: '#B2' },
      { name: 'Meena', orderNo: '#C3' },
      { name: 'No Order', orderNo: null }, // MISSING_VARIABLE
      { name: 'Opted Out', utility: 'REVOKED' }, // OPTED_OUT (temporary UTILITY rule)
      { name: 'Blocked Person', status: 'BLOCKED' }, // BLOCKED
    ])
    const c = await draftCampaign(w, tagId)

    // Review: the audience is evaluated (not snapshotted) with reasons and rendered samples.
    const est = (await w.owner.client.post(`/campaigns/${c.id}/estimate`)).body.data
    expect(est).toMatchObject({
      total: 6,
      sendable: 3,
      skipped: { MISSING_VARIABLE: 1, OPTED_OUT: 1, BLOCKED: 1 },
      billingEnforced: false,
    })
    expect(est.samples[0].variables.body).toEqual(['Asha', '#A1'])
    expect(est.estimatedCostMinor).toBe(3 * 13)

    // Launch is idempotent: the same key twice → one launch.
    const key = `launch-${metaId()}`
    const first = await launch(w, c.id, key)
    expect(first.status, first.text).toBe(200)
    const again = await launch(w, c.id, key)
    expect(again.status).toBe(200)
    expect(again.headers['idempotent-replayed']).toBe('true')
    // A different key can't relaunch it.
    expect((await launch(w, c.id)).body.error.code).toBe('CAMPAIGN_INVALID_STATE')

    const done = await finished(w, c.id)
    expect(done.template).toMatchObject({ name: 'order_update', category: 'UTILITY' })
    expect(done.totalRecipients).toBe(6)

    // Every sent message went through MessagingService: CAMPAIGN source, linked, rendered.
    const sends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(sends).toHaveLength(3)
    const bodies = sends.map((s) =>
      JSON.stringify((s.payload.template as { components: unknown[] }).components),
    )
    expect(bodies.some((b) => b.includes('"Asha"') && b.includes('"#A1"'))).toBe(true)
    const messages = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.findMany({ where: { campaignId: c.id } }),
    )
    expect(messages).toHaveLength(3)
    expect(messages.every((m) => m.source === 'CAMPAIGN')).toBe(true)

    // Recipient results follow the status webhooks.
    const stats = await waitFor(
      () => statsOf(w, c.id),
      (s) => s.read === 3,
    )
    expect(stats).toMatchObject({
      total: 6,
      eligible: 3,
      skipped: 3,
      sent: 3,
      delivered: 3,
      read: 3,
      failed: 0,
      deliveryRate: 1,
      readRate: 1,
      failureRate: 0,
      skipReasons: { MISSING_VARIABLE: 1, OPTED_OUT: 1, BLOCKED: 1 },
    })
    const skipped = await recipientsOf(w, c.id, '&status=SKIPPED')
    expect(skipped.map((r) => r.skipReason).sort()).toEqual([
      'BLOCKED',
      'MISSING_VARIABLE',
      'OPTED_OUT',
    ])
  })

  it('marketing needs consent: non-consenting contacts are skipped with NO_MARKETING_CONSENT', async () => {
    const w = await world('cmp-mkt')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `mkt-${metaId()}`, [
      { name: 'Yes', marketing: 'GRANTED' },
      { name: 'Never asked', marketing: 'NONE' },
      { name: 'Said stop', marketing: 'REVOKED' },
    ])
    const c = await draftCampaign(w, tagId, {
      templateVersionId: w.marketing.versionId,
      variableMapping: { body: [{ kind: 'FIELD', field: 'firstName' }] },
    })
    await launch(w, c.id)
    await finished(w, c.id)
    const stats = await statsOf(w, c.id)
    expect(stats.skipReasons).toEqual({ NO_MARKETING_CONSENT: 1, OPTED_OUT: 1 })
    expect(stats.eligible).toBe(1)
  })

  it('snapshots the audience: contacts tagged after launch are not added', async () => {
    const w = await world('cmp-snapshot')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `snap-${metaId()}`, [
      { name: 'A' },
      { name: 'B' },
    ])
    const c = await draftCampaign(w, tagId)
    await launch(w, c.id)
    await waitFor(
      () => campaignOf(w, c.id),
      (x) => Boolean(x.audienceSnapshotAt) && x.status !== 'PREPARING',
    )
    // A contact joins the tag afterwards.
    await db.withTenant(w.owner.tenantId, async (tx) => {
      const late = await tx.contact.create({
        data: {
          tenantId: w.owner.tenantId,
          phoneE164: `+9199${Date.now().toString().slice(-8)}`,
          name: 'Late',
          source: 'MANUAL',
        },
      })
      await tx.contactTag.create({
        data: { tenantId: w.owner.tenantId, contactId: late.id, tagId },
      })
    })
    await finished(w, c.id)
    expect((await statsOf(w, c.id)).total).toBe(2)
  })

  it('scheduled campaigns survive restarts and launch once with competing schedulers', async () => {
    const w = await world('cmp-schedule')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `sch-${metaId()}`, [
      { name: 'A' },
      { name: 'B' },
    ])
    const at = new Date(Date.now() + 10 * 60_000)
    const c = await draftCampaign(w, tagId, { scheduleAt: at.toISOString() })
    const launched = await launch(w, c.id)
    expect(launched.body.data).toMatchObject({ status: 'SCHEDULED', scheduleAt: at.toISOString() })
    // Nothing is sent before the time, even across a worker restart (state lives in Postgres).
    const processor = worker.get(CampaignDispatchProcessor)
    expect(await processor.scheduleDue(new Date())).toBe(0)
    await worker.close()
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, ...WORKER_ENV })
    const restarted = worker.get(CampaignDispatchProcessor)
    // Two schedulers at the due time: exactly one wins.
    const later = new Date(at.getTime() + 1000)
    const wins = await Promise.all([restarted.scheduleDue(later), restarted.scheduleDue(later)])
    expect(wins.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1)
    await finished(w, c.id)
    const campaignSends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(campaignSends).toHaveLength(2)
    const events = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.outboxEvent.count({ where: { eventType: 'campaign.launched', aggregateId: c.id } }),
    )
    expect(events).toBe(1)
  })

  it('duplicate dispatch and worker restarts never send twice', async () => {
    const w = await world('cmp-dup')
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `dup-${metaId()}`,
      Array.from({ length: 12 }, (_, i) => ({ name: `P${i}` })),
    )
    const c = await draftCampaign(w, tagId, { rateLimitPerMinute: 60 }) // 5 per 5 s: time to interfere
    await launch(w, c.id)
    const running = await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'RUNNING',
    )
    const processor = worker.get(CampaignDispatchProcessor)
    const gen = (
      await db.withTenant(w.owner.tenantId, (tx) =>
        tx.campaign.findFirstOrThrow({ where: { id: running.id } }),
      )
    ).dispatchGeneration
    // The same batch run concurrently by two "workers", plus the recovery pass.
    await Promise.all([
      processor.dispatch({
        tenantId: w.owner.tenantId,
        campaignId: c.id,
        generation: gen,
        batch: 50,
      }),
      processor.dispatch({
        tenantId: w.owner.tenantId,
        campaignId: c.id,
        generation: gen,
        batch: 51,
      }),
      processor.recover(),
    ])
    // A worker crash mid-campaign: the new worker's recovery pass finishes it.
    await worker.close()
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, ...WORKER_ENV })
    await worker.get(CampaignDispatchProcessor).recover()
    await finished(w, c.id)
    const sends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(sends).toHaveLength(12)
    expect(new Set(sends.map((s) => s.payload.to)).size).toBe(12)
  })

  it('pause stops dispatch; resume finishes without duplicates; cancel skips the rest', async () => {
    const w = await world('cmp-pause')
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `pause-${metaId()}`,
      Array.from({ length: 15 }, (_, i) => ({ name: `P${i}` })),
    )
    const c = await draftCampaign(w, tagId, { rateLimitPerMinute: 60 })
    await launch(w, c.id)
    await waitFor(
      () => statsOf(w, c.id),
      (s) => s.total === 15 && s.pending < 15,
    )
    const paused = await w.owner.client.post(`/campaigns/${c.id}/pause`)
    expect(paused.body.data).toMatchObject({ status: 'PAUSED', pauseReason: 'MANUAL' })
    // Sends already handed to MessagingService finish; nothing new starts after that.
    await new Promise((r) => setTimeout(r, 1500))
    const atPause = await statsOf(w, c.id)
    await new Promise((r) => setTimeout(r, 6000))
    const later = await statsOf(w, c.id)
    expect(later.pending).toBe(atPause.pending) // nothing new dispatched while paused
    expect(later.pending).toBeGreaterThan(0)
    expect((await w.owner.client.post(`/campaigns/${c.id}/resume`)).body.data.status).toBe(
      'RUNNING',
    )
    await finished(w, c.id)
    const sends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(sends).toHaveLength(15)

    // Cancel: a paused campaign's remaining recipients are skipped (CANCELLED); terminal.
    const { tagId: tag2 } = await seedContacts(
      db,
      w.owner.tenantId,
      `cancel-${metaId()}`,
      Array.from({ length: 25 }, (_, i) => ({ name: `C${i}` })),
    )
    const c2 = await draftCampaign(w, tag2, { rateLimitPerMinute: 30 })
    await launch(w, c2.id)
    await waitFor(
      () => campaignOf(w, c2.id),
      (x) => x.status === 'RUNNING',
    )
    await w.owner.client.post(`/campaigns/${c2.id}/pause`)
    const cancelled = await w.owner.client.post(`/campaigns/${c2.id}/cancel`)
    expect(cancelled.body.data.status).toBe('CANCELLED')
    const s2 = await statsOf(w, c2.id)
    expect(s2.pending).toBe(0)
    expect(s2.skipReasons.CANCELLED).toBeGreaterThan(0)
    expect((await w.owner.client.post(`/campaigns/${c2.id}/resume`)).body.error.code).toBe(
      'CAMPAIGN_INVALID_STATE',
    )
  })

  it('consent revoked after the snapshot: that recipient is skipped at send time', async () => {
    const w = await world('cmp-consent')
    const { tagId, contactIds } = await seedContacts(
      db,
      w.owner.tenantId,
      `cons-${metaId()}`,
      Array.from({ length: 25 }, (_, i) => ({ name: `P${i}` })),
    )
    const c = await draftCampaign(w, tagId, { rateLimitPerMinute: 30 }) // second batch ~10 s later
    await launch(w, c.id)
    await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'RUNNING',
    )
    const last = contactIds.at(-1)!
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.contact.update({ where: { id: last }, data: { utilityConsent: 'REVOKED' } }),
    )
    await finished(w, c.id)
    const r = (await recipientsOf(w, c.id)).find((x) => x.contactId === last)!
    expect(r).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
      errorCode: 'CONSENT_REQUIRED',
    })
  })

  it('Meta temporary failure retries once-only; permanent failure fails the recipient, not the campaign', async () => {
    const w = await world('cmp-meta-errors')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `err-${metaId()}`, [
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
    ])
    await control('fail', {
      pathContains: `${w.ids.phoneNumberId}/messages`,
      method: 'POST',
      status: 500,
      code: 2,
      times: 2,
    })
    const c = await draftCampaign(w, tagId)
    await launch(w, c.id)
    await finished(w, c.id)
    let sends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(sends).toHaveLength(3)

    const { tagId: t2 } = await seedContacts(db, w.owner.tenantId, `perm-${metaId()}`, [
      { name: 'X' },
      { name: 'Y' },
    ])
    await control('fail', {
      pathContains: `${w.ids.phoneNumberId}/messages`,
      method: 'POST',
      status: 400,
      code: 131026,
      times: 1,
    })
    const c2 = await draftCampaign(w, t2)
    await launch(w, c2.id)
    const done = await finished(w, c2.id)
    expect(done.status).toBe('COMPLETED')
    const stats = await waitFor(
      () => statsOf(w, c2.id),
      (s) => s.failed === 1 && s.sent === 1,
    )
    expect(stats.failureCodes).toEqual({ META_UNDELIVERABLE: 1 })
    sends = sendsTo(mock.state, w.ids.phoneNumberId)
    expect(sends.length).toBeGreaterThan(0)
  })

  it('duplicate status webhooks do not double-count recipient results', async () => {
    statuses(['sent'])
    const w = await world('cmp-webhook-dup')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `wh-${metaId()}`, [{ name: 'A' }])
    const c = await draftCampaign(w, tagId)
    await launch(w, c.id)
    await finished(w, c.id)
    const [r] = await recipientsOf(w, c.id)
    const message = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.findFirstOrThrow({ where: { id: r!.messageId as string } }),
    )
    const ids = { wabaId: w.ids.wabaId, phoneNumberId: w.ids.phoneNumberId }
    const delivered = statusWebhook(ids, { wamid: message.providerMessageId!, status: 'delivered' })
    for (let i = 0; i < 3; i++) await deliverWebhook(webhookUrl, SECRET, delivered)
    // An older status arriving late never moves it back.
    await deliverWebhook(
      webhookUrl,
      SECRET,
      statusWebhook(ids, { wamid: message.providerMessageId!, status: 'sent' }),
    )
    const stats = await waitFor(
      () => statsOf(w, c.id),
      (s) => s.delivered === 1,
    )
    expect(stats).toMatchObject({ total: 1, sent: 1, delivered: 1, read: 0 })
    statuses(['sent', 'delivered', 'read'])
  })

  it('template paused during a campaign pauses it; disabled fails it and skips the rest', async () => {
    const w = await world('cmp-template')
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `tpl-${metaId()}`,
      Array.from({ length: 25 }, (_, i) => ({ name: `P${i}` })),
    )
    const c = await draftCampaign(w, tagId, { rateLimitPerMinute: 30 })
    await launch(w, c.id)
    await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'RUNNING',
    )
    const t = (await w.owner.client.get('/templates?q=order_update')).body.data[0]
    await control('template-event', { id: t.currentVersion.metaTemplateId, event: 'PAUSED' })
    const paused = await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'PAUSED',
      40_000,
    )
    expect(paused.pauseReason).toBe('TEMPLATE_PAUSED')
    // Resume is refused while the template is paused.
    expect((await w.owner.client.post(`/campaigns/${c.id}/resume`)).body.error.code).toBe(
      'CAMPAIGN_NOT_READY',
    )
    await control('template-event', { id: t.currentVersion.metaTemplateId, event: 'APPROVED' })
    await waitFor(
      () => w.owner.client.get(`/templates/${t.id}`).then((r) => r.body.data.status),
      (s) => s === 'APPROVED',
    )
    expect((await w.owner.client.post(`/campaigns/${c.id}/resume`)).body.data.status).toBe(
      'RUNNING',
    )
    await finished(w, c.id)

    // Disabled mid-campaign: FAILED, remaining recipients SKIPPED (TEMPLATE_UNAVAILABLE).
    const { tagId: t2 } = await seedContacts(
      db,
      w.owner.tenantId,
      `tpl2-${metaId()}`,
      Array.from({ length: 25 }, (_, i) => ({ name: `Q${i}` })),
    )
    const c2 = await draftCampaign(w, t2, { rateLimitPerMinute: 30 })
    await launch(w, c2.id)
    await waitFor(
      () => campaignOf(w, c2.id),
      (x) => x.status === 'RUNNING',
    )
    await control('template-event', { id: t.currentVersion.metaTemplateId, event: 'DISABLED' })
    const failed = await waitFor(
      () => campaignOf(w, c2.id),
      (x) => x.status === 'FAILED',
      40_000,
    )
    expect(failed.failureReason).toMatch(/no longer available/)
    const s = await statsOf(w, c2.id)
    expect(s.pending).toBe(0)
    expect(s.skipReasons.TEMPLATE_UNAVAILABLE).toBeGreaterThan(0)
    // A campaign can't be launched with an unavailable template.
    const c3 = await draftCampaign(w, t2)
    const refused = await launch(w, c3.id)
    expect([refused.status, refused.body.error.code]).toEqual([422, 'CAMPAIGN_NOT_READY'])
  })

  it('isolates tenants: B can’t read, launch, control, export or inspect A’s campaign', async () => {
    const a = await world('cmp-iso-a')
    const b = await world('cmp-iso-b')
    const { tagId } = await seedContacts(db, a.owner.tenantId, `iso-${metaId()}`, [{ name: 'A' }])
    const c = await draftCampaign(a, tagId)
    const B = b.owner.client
    expect((await B.get(`/campaigns/${c.id}`)).status).toBe(404)
    expect(
      (await B.post(`/campaigns/${c.id}/launch`, {}, { 'Idempotency-Key': `x-${metaId()}` }))
        .status,
    ).toBe(404)
    await launch(a, c.id)
    await finished(a, c.id)
    for (const action of ['pause', 'resume', 'cancel', 'estimate', 'recipients/export'])
      expect((await B.post(`/campaigns/${c.id}/${action}`)).status, action).toBe(404)
    expect((await B.get(`/campaigns/${c.id}/recipients`)).status).toBe(404)
    expect((await B.get(`/campaigns/${c.id}/stats`)).status).toBe(404)
    expect((await B.get('/campaigns')).body.data.map((x: { id: string }) => x.id)).not.toContain(
      c.id,
    )
    // B can't target A's contacts or tags either: A's tag matches nothing in B.
    const cb = await draftCampaign(b, tagId)
    const est = (await B.post(`/campaigns/${cb.id}/estimate`)).body.data
    expect(est.total).toBe(0)
    // The owner can export; the CSV has every recipient.
    const csv = await a.owner.client.post(`/campaigns/${c.id}/recipients/export`)
    expect(csv.status).toBe(200)
    expect(csv.text.trim().split('\n')).toHaveLength(2)
  })

  it('handles a larger synthetic audience in pages and batches (2,000 contacts)', async () => {
    statuses(['sent'])
    const w = await world('cmp-perf')
    const { tagId } = await seedContacts(
      db,
      w.owner.tenantId,
      `perf-${metaId()}`,
      Array.from({ length: 2000 }, (_, i) => ({ name: `Bulk ${i}` })),
    )
    const c = await draftCampaign(w, tagId)
    const started = Date.now()
    await launch(w, c.id)
    await finished(w, c.id, 'COMPLETED', 240_000)
    const seconds = (Date.now() - started) / 1000
    const stats = await statsOf(w, c.id)
    expect(stats).toMatchObject({ total: 2000, eligible: 2000, sent: 2000, failed: 0 })
    const sends = sendsTo(mock.state, w.ids.phoneNumberId).filter(
      (s) => (s.payload.template as { name: string } | undefined)?.name === 'order_update',
    )
    expect(sends).toHaveLength(2000)
    expect(new Set(sends.map((s) => s.payload.to)).size).toBe(2000)
    process.stdout.write(`2,000-recipient campaign completed in ${seconds.toFixed(1)} s\n`)
    statuses(['sent', 'delivered', 'read'])
  }, 300_000)
})
