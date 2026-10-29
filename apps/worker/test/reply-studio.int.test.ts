import { AutomationExecuteProcessor } from '@fenwira/api/modules/automation'
import { OutboundProcessor } from '@fenwira/api/modules/messaging'
import { QUEUES } from '@fenwira/queue'
import { Queue } from 'bullmq'
import { replyPreset } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { deliverWebhook, inboundMessageWebhook, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'
import { metaId, waitFor } from './support/campaigns'
import { execution, executions, publish, saveDraft, type Graph } from './support/automation'
const SECRET = 'reply-studio-test-secret'
let api: INestApplication, worker: INestApplication, db: Database, webhook: string
let mock: Awaited<ReturnType<typeof startMetaMock>>
type World = { owner: Member; ids: { wabaId: string; phoneNumberId: string }; flowId: string }
const customer = () => `9198${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const send = async (
  w: World,
  from: string,
  text: string,
  wamid = `wamid.${metaId()}`,
  body?: Record<string, unknown>,
) =>
  expect(
    await deliverWebhook(
      webhook,
      SECRET,
      inboundMessageWebhook(w.ids, { from, wamid, text, body }),
    ),
  ).toBe(200)
async function world(graph = replyPreset('product-enquiry')): Promise<World> {
  const owner = await createOwner(api, 'reply-studio')
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  expect(
    (
      await owner.client.post('/whatsapp/connections/dev', {
        ...ids,
        accessToken: `mock-dev:${ids.wabaId}`,
      })
    ).status,
  ).toBe(201)
  const ownerUserId = (await owner.client.get('/auth/me')).body.data.user.id as string
  const tag = await owner.client.post('/tags', { name: `Enquiry ${metaId()}` })
  for (const n of graph.nodes)
    if (n.type === 'action.handover') {
      n.config.userId = ownerUserId
      n.config.tagIds = [tag.body.data.id]
    }
  const created = await owner.client.post('/flows', { name: 'Enquiry', managedBy: 'REPLY_STUDIO' })
  expect(created.status).toBe(201)
  const flowId = created.body.data.id as string
  await saveDraft(owner, flowId, graph as Graph)
  const published = await publish(owner, flowId)
  expect(published.status, published.text).toBe(200)
  return { owner, ids, flowId }
}
async function state(w: World, node: string, from?: string) {
  return waitFor(
    () =>
      db.withTenant(w.owner.tenantId, (tx) =>
        tx.automationExecution.findFirst({
          where: { flowId: w.flowId, ...(from ? { contact: { phoneE164: `+${from}` } } : {}) },
          orderBy: { startedAt: 'desc' },
        }),
      ),
    (e) => e?.status === 'WAITING' && e.currentNodeId === node,
  )
}
const messages = (w: World) =>
  db.withTenant(w.owner.tenantId, (tx) =>
    tx.message.findMany({ where: { source: 'AUTOMATION' }, orderBy: { createdAt: 'asc' } }),
  )
async function report(w: World) {
  const r = await w.owner.client.get(
    `/reply-studio/reports?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`,
  )
  expect(r.status, r.text).toBe(200)
  return r.body.data
}
beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  webhook = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhook, appSecret: SECRET, statuses: [], delayMs: 10 }
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
}, 60000)
afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Reply Studio acceptance through mock WhatsApp', { timeout: 120000 }, () => {
  it('dedupes webhooks, consumes rapid messages in order, resumes after restart, pins the draft, reviews and hands over', async () => {
    const w = await world(),
      from = customer(),
      wamid = `wamid.${metaId()}`
    await send(w, from, 'enquiry', wamid)
    await send(w, from, 'enquiry', wamid)
    const initial = (await state(w, 'category'))!
    expect(await executions(w.owner, w.flowId)).toHaveLength(1)
    const draft = replyPreset('product-enquiry')
    draft.nodes.find((n) => n.id === 'product')!.config.text = 'Changed draft question'
    await saveDraft(w.owner, w.flowId, draft as Graph)
    await send(w, from, 'Clothing')
    await state(w, 'product')
    // Persist both inbound messages before driving the next question; session FIFO must keep both.
    await send(w, from, 'Cotton shirt')
    await send(w, from, 'Blue, size M')
    const rapid = (await state(w, 'quantity'))!
    expect((rapid.context as { vars: Record<string, string> }).vars).toMatchObject({
      product: 'Cotton shirt',
      preference: 'Blue, size M',
    })
    expect(rapid.flowVersionId).toBe(initial.flowVersionId)
    expect(
      (await messages(w)).some(
        (m) => (m.content as { text?: string }).text === 'Changed draft question',
      ),
    ).toBe(false)
    await worker.close()
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
    await send(w, from, '12')
    await state(w, 'required_date')
    await send(w, from, '2026-12-15')
    await state(w, 'confirm')
    await send(w, from, 'Confirm')
    await waitFor(
      () => execution(w.owner, initial.id),
      (e) => e.status === 'COMPLETED',
    )
    const rows = await db.withTenant(w.owner.tenantId, async (tx) => ({
      notes: await tx.conversationNote.findMany({
        where: { conversationId: initial.conversationId! },
      }),
      conversation: await tx.conversation.findFirst({ where: { id: initial.conversationId! } }),
      tags: await tx.contactTag.count({ where: { contactId: initial.contactId } }),
    }))
    expect(rows.notes[0]?.body).toContain('Cotton shirt')
    expect(rows.notes[0]?.body).toContain('Blue, size M')
    expect(rows.conversation?.automationState).toBe('AGENT_TAKEOVER')
    expect(rows.tags).toBe(1)
    expect((await report(w)).totals).toMatchObject({
      starts: 1,
      completions: 1,
      handovers: 1,
      failures: 0,
    })
  })
  it('re-asks invalid answers, handles stale taps politely, and sends the fallback once in 24 hours', async () => {
    const w = await world(),
      from = customer()
    await send(w, from, 'enquiry')
    const session = (await state(w, 'category'))!
    await send(w, from, '', undefined, {
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: `rs:${session.id}:old-menu:Clothing`, title: 'Clothing' },
      },
    })
    await waitFor(
      () => messages(w),
      (rows) =>
        rows.some((m) =>
          (m.content as { text?: string }).text?.includes('That option is no longer available'),
        ),
    )
    for (let i = 0; i < 3; i++) {
      await send(w, from, 'invalid')
      await new Promise((r) => setTimeout(r, 300))
    }
    await waitFor(
      () => execution(w.owner, session.id),
      (e) => e.status === 'COMPLETED',
    )
    expect((await report(w)).totals).toMatchObject({ fallbacks: 1, handovers: 1 })
    expect(
      (await messages(w)).filter((m) =>
        (m.content as { text?: string }).text?.includes('Sorry, I could not understand'),
      ),
    ).toHaveLength(1)
  })
  it('expires durably, optionally closes while eligible, and a restart word starts a fresh session', async () => {
    const graph = replyPreset('product-enquiry')
    graph.replyStudio!.closingMessage = 'This enquiry has expired. Send enquiry to start again.'
    const w = await world(graph),
      from = customer()
    await send(w, from, 'enquiry')
    const first = (await state(w, 'category'))!
    await send(w, from, 'MENU!')
    await waitFor(
      () => executions(w.owner, w.flowId),
      (rows) => rows.length === 2,
    )
    const current = (await state(w, 'category'))!
    expect(current.id).not.toBe(first.id)
    expect((await execution(w.owner, first.id)).errorCode).toBe('SESSION_RESTART')
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.automationExecution.update({
        where: { id: current.id },
        data: {
          waitUntil: new Date(0),
          context: {
            ...(current.context as object),
            reply: {
              ...(current.context as { reply: object }).reply,
              deadline: new Date(0).toISOString(),
            },
          },
        },
      }),
    )
    await worker.get(AutomationExecuteProcessor).run(w.owner.tenantId, current.id)
    expect((await execution(w.owner, current.id)).errorCode).toBe('SESSION_EXPIRED')
    await send(w, from, 'enquiry')
    await waitFor(
      () => executions(w.owner, w.flowId),
      (rows) => rows.length === 3,
    )
    expect((await report(w)).totals.expired).toBe(1)
  })
  it('takeover stops the session and persists cancellation of queued replies', async () => {
    const w = await world(),
      from = customer()
    await send(w, from, 'enquiry')
    const e = (await state(w, 'category'))!
    const pending = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.create({
        data: {
          tenantId: w.owner.tenantId,
          conversationId: e.conversationId!,
          contactId: e.contactId,
          direction: 'OUTBOUND',
          source: 'AUTOMATION',
          type: 'TEXT',
          status: 'QUEUED',
          content: { type: 'TEXT', text: 'Queued bot reply' },
        },
      }),
    )
    expect(
      (
        await w.owner.client.post(`/conversations/${e.conversationId}/automation-state`, {
          state: 'AGENT_TAKEOVER',
        })
      ).status,
    ).toBe(200)
    await waitFor(
      () => execution(w.owner, e.id),
      (e) => e.status === 'STOPPED_TAKEOVER',
    )
    const message = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.findFirstOrThrow({ where: { id: pending.id } }),
    )
    expect(message.status).toBe('FAILED')
    expect(message.errorCode).toBe('AUTOMATION_BLOCKED_BY_TAKEOVER')
  })
  it('blocks invalid publish, reports failed sends, and isolates workspace settings and executions', async () => {
    const w = await world(replyPreset('keyword')),
      other = await createOwner(api, 'reply-other')
    const graph = replyPreset('keyword')
    graph.nodes.find((n) => n.id === 'reply')!.config.text = ''
    await saveDraft(w.owner, w.flowId, graph as Graph)
    expect((await publish(w.owner, w.flowId)).status).toBe(422)
    await control('fail', {
      pathContains: `${w.ids.phoneNumberId}/messages`,
      code: 131026,
      status: 400,
      times: 1,
    })
    await send(w, customer(), 'location')
    await waitFor(
      () => report(w),
      (r) => r.totals.failures === 1,
    )
    expect((await report(w)).failures[0]?.conversationId).toBeTruthy()
    expect((await other.client.get(`/flows/${w.flowId}`)).status).toBe(404)
    expect(
      await db.withTenant(other.tenantId, (tx) => tx.flow.findMany({ where: { id: w.flowId } })),
    ).toEqual([])
    const isolated = await db.withTenant(other.tenantId, (tx) =>
      tx.tenant.updateMany({ where: { id: w.owner.tenantId }, data: { businessHours: {} } }),
    )
    expect(isolated.count).toBe(0)
    expect((await other.client.get('/reply-studio/business-hours')).body.data.timezone).toBe(
      'Asia/Kolkata',
    )
  })
  it('uses business hours for live conditions and dry runs, and isolates the schedule', async () => {
    const w = await world(replyPreset('out-of-hours'))
    const schedule = {
      timezone: 'Asia/Kolkata',
      week: Array.from({ length: 7 }, () => ({ closed: true, open: '09:00', close: '18:00' })),
      holidays: ['2026-12-25'],
    }
    const saved = await w.owner.client.put('/reply-studio/business-hours', schedule)
    expect(saved.status, saved.text).toBe(200)
    const dry = await w.owner.client.post(`/flows/${w.flowId}/test`, {
      message: 'Hello',
      at: '2026-10-29T06:00:00Z',
    })
    expect(dry.status, dry.text).toBe(200)
    expect(dry.body.data.steps.find((s: { nodeId: string }) => s.nodeId === 'hours').handle).toBe(
      'no',
    )
    await send(w, customer(), 'Hello')
    await waitFor(
      () => executions(w.owner, w.flowId),
      (rows) => rows[0]?.status === 'COMPLETED',
    )
    expect(
      (await messages(w)).some((m) =>
        (m.content as { text?: string }).text?.includes('currently closed'),
      ),
    ).toBe(true)
  })
  it('welcomes only the first message and enforces contact cooldown across numbers', async () => {
    const w = await world(replyPreset('welcome')),
      from = customer()
    await send(w, from, 'Hello')
    await waitFor(
      () => executions(w.owner, w.flowId),
      (rows) => rows[0]?.status === 'COMPLETED',
    )
    await send(w, from, 'Hello again')
    const ids = { wabaId: metaId(), phoneNumberId: metaId() }
    await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
    expect(
      (
        await w.owner.client.post('/whatsapp/connections/dev', {
          ...ids,
          accessToken: `mock-dev:${ids.wabaId}`,
        })
      ).status,
    ).toBe(201)
    await send({ ...w, ids }, from, 'Hello on another number')
    await waitFor(
      () =>
        db.withTenant(w.owner.tenantId, (tx) =>
          tx.message.count({ where: { direction: 'INBOUND' } }),
        ),
      (n) => n === 3,
    )
    await new Promise((r) => setTimeout(r, 1500))
    expect(await executions(w.owner, w.flowId)).toHaveLength(1)
  })
  it('never sends a reply cancelled after outbound loading but before its send claim', async () => {
    const w = await world(),
      from = customer()
    const phone = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.whatsAppPhoneNumber.findFirstOrThrow({ where: { phoneNumberId: w.ids.phoneNumberId } }),
    )
    const outbound = worker.get(OutboundProcessor) as unknown as {
      takeToken: (number: string, rate: number) => Promise<boolean>
    }
    const original = outbound.takeToken.bind(outbound)
    let release!: () => void,
      entered = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    outbound.takeToken = async (number, rate) => {
      if (number === phone.id) {
        entered = true
        await gate
      }
      return original(number, rate)
    }
    const queue = new Queue(QUEUES.whatsappOutbound, {
      connection: { url: process.env.REDIS_URL! },
    })
    try {
      await send(w, from, 'enquiry')
      await waitFor(
        async () => entered,
        (value) => value,
      )
      const e = (await state(w, 'category'))!
      expect(
        (
          await w.owner.client.post(`/conversations/${e.conversationId}/automation-state`, {
            state: 'AGENT_TAKEOVER',
          })
        ).status,
      ).toBe(200)
      release()
      await waitFor(
        () => queue.getActiveCount(),
        (n) => n === 0,
      )
      expect(mock.state.sent.filter((m) => m.phoneNumberId === w.ids.phoneNumberId)).toHaveLength(0)
      expect((await messages(w)).every((m) => m.status === 'FAILED')).toBe(true)
    } finally {
      release()
      outbound.takeToken = original
      await queue.close()
    }
  })
})
