import {
  AutomationExecuteProcessor,
  AutomationTriggerProcessor,
} from '@fenwira/api/modules/automation'
import { EntitlementsService } from '@fenwira/api/modules/entitlements'
import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { Queue } from 'bullmq'
import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  automationMessages,
  chain,
  createFlow,
  delay,
  dueNow,
  end,
  execution,
  executions,
  executionsWhere,
  type Graph,
  keyword,
  publish,
  saveDraft,
  terminal,
  text,
  textOf,
} from './support/automation'
import { campaignWorld, metaId, waitFor } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * Phase 10 acceptance (docs/prompts/PHASE_10_AUTOMATION.md, decisions P10-D1–D4) against the
 * in-process meta-mock and a local webhook receiver (the P10-D4 development exception names
 * 127.0.0.1 only). Delays are fast-forwarded by moving wait_until and driving the processor.
 */
const SECRET = 'automation-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let apiUrl: string
let webhookUrl: string
let receiver: Server
let receiverUrl: string
const received: Array<{ path: string; headers: Record<string, unknown>; body: string }> = []

const customer = () => `9197${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const exec = () => worker.get(AutomationExecuteProcessor)

type Ws = { owner: Member; ids: { wabaId: string; phoneNumberId: string }; phoneId: string }
async function workspace(label: string): Promise<Ws> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  return { owner, ids, phoneId: res.body.data.id }
}

const inbound = (w: { ids: Ws['ids'] }, from: string, body: string) =>
  deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, {
      from,
      wamid: `wamid.${metaId()}`,
      text: body,
      name: 'Ada Lovelace',
    }),
  )

const run = async (m: Member, flowId: string, runId: string) =>
  (await m.client.get(`/flows/${flowId}/trigger-runs/${runId}`)).body.data as {
    status: string
    stopReason: string | null
    plan: Array<{
      flowId: string
      priority: number
      status: string
      reason: string | null
      executionId: string | null
    }>
  }

const tag = (w: Ws, name: string) =>
  db.withTenant(w.owner.tenantId, (tx) =>
    tx.tag.create({ data: { tenantId: w.owner.tenantId, name: `${name}-${metaId()}` } }),
  )
const contactTags = (w: Ws, phone: string) =>
  db.withTenant(w.owner.tenantId, async (tx) => {
    const c = await tx.contact.findFirst({ where: { phoneE164: `+${phone}` } })
    if (!c) return []
    return (await tx.contactTag.findMany({ where: { contactId: c.id } })).map((t) => t.tagId)
  })

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: [], delayMs: 20 }
  worker = await bootWorker({
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
    AUTOMATION_WEBHOOK_DEV_HOSTS: '127.0.0.1',
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  receiver = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body })
      if (req.url?.startsWith('/fail')) res.writeHead(500).end('nope')
      else res.setHeader('content-type', 'application/json').end(JSON.stringify({ tier: 'vip' }))
    })
  })
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r))
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => receiver?.close(() => r()))
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 10: flows and execution', { timeout: 120_000 }, () => {
  it('keyword → condition → send: MessagingService only, history shows the path, deterministic', async () => {
    const w = await workspace('auto-basic')
    const vip = await tag(w, 'vip')
    const graph: Graph = {
      nodes: [
        keyword('hello'),
        { id: 'is-vip', type: 'condition.has_tag', config: { tagIds: [vip.id], match: 'ANY' } },
        text('vip-reply', 'Welcome back {{contact.firstName}} (VIP)'),
        text('reply', 'Hi {{contact.firstName}}, you said "{{trigger.message.text}}"'),
        end('end1'),
        end('end2'),
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'is-vip', sourceHandle: 'next' },
        { id: '2', source: 'is-vip', target: 'vip-reply', sourceHandle: 'yes' },
        { id: '3', source: 'is-vip', target: 'reply', sourceHandle: 'no' },
        { id: '4', source: 'vip-reply', target: 'end1', sourceHandle: 'next' },
        { id: '5', source: 'reply', target: 'end2', sourceHandle: 'next' },
      ],
      layout: {},
    }
    const flowId = await createFlow(w.owner, 'Greeter', graph)
    const [a, b] = [customer(), customer()]
    await inbound(w, a, 'Hello')
    await inbound(w, b, 'HELLO')
    const list = await executionsWhere(w.owner, flowId, (e) => e.status === 'COMPLETED', 2)
    const detail = await Promise.all(list.map((e) => execution(w.owner, e.id)))
    const path = (e: (typeof detail)[number]) => e.steps!.map((s) => `${s.nodeId}:${s.status}`)
    // Determinism: the same trigger and data give the same step sequence.
    expect(path(detail[0]!)).toEqual([
      'trigger:SUCCEEDED',
      'is-vip:SUCCEEDED',
      'reply:SUCCEEDED',
      'end2:SUCCEEDED',
    ])
    expect(path(detail[1]!)).toEqual(path(detail[0]!))
    const msgs = await automationMessages(db, w.owner.tenantId)
    expect(msgs.map(textOf).sort()).toEqual([
      'Hi Ada, you said "HELLO"',
      'Hi Ada, you said "Hello"',
    ])
    // Idempotency key per execution step.
    expect(msgs.every((m) => /^auto:[0-9a-f-]{36}:3$/.test(m.idempotencyKey!))).toBe(true)
    // A non-matching message starts nothing.
    await inbound(w, customer(), 'goodbye')
    await new Promise((r) => setTimeout(r, 1500))
    expect(await executions(w.owner, flowId)).toHaveLength(2)
  })

  it('AE3: matching flows run one at a time in priority order; a trigger run records the plan', async () => {
    const w = await workspace('auto-order')
    const ids: Record<number, string> = {}
    for (const p of [30, 10, 20])
      ids[p] = await createFlow(w.owner, `P${p}`, chain(keyword('order'), text('s', `flow ${p}`)), {
        priority: p,
      })
    await inbound(w, customer(), 'order')
    const done = await Promise.all(
      [10, 20, 30].map((p) => executionsWhere(w.owner, ids[p]!, (e) => e.status === 'COMPLETED')),
    )
    const [e10, e20, e30] = done.map((l) => l[0]!)
    // Sequential, never concurrent.
    expect(new Date(e20!.startedAt) >= new Date(e10!.finishedAt!)).toBe(true)
    expect(new Date(e30!.startedAt) >= new Date(e20!.finishedAt!)).toBe(true)
    const r = await run(w.owner, ids[10]!, e10!.triggerRunId!)
    expect(r.status).toBe('COMPLETED')
    expect(r.plan.map((p) => [p.priority, p.status])).toEqual([
      [10, 'COMPLETED'],
      [20, 'COMPLETED'],
      [30, 'COMPLETED'],
    ])
    const texts = (await automationMessages(db, w.owner.tenantId)).map(textOf)
    expect(texts).toEqual(['flow 10', 'flow 20', 'flow 30'])
  })

  it('P10-D2: an agent reply stops the running flow (STOPPED_TAKEOVER) and skips the rest', async () => {
    const w = await workspace('auto-takeover')
    const first = await createFlow(
      w.owner,
      'First',
      chain(
        keyword('help'),
        text('ack', 'One moment'),
        delay('wait'),
        text('later', 'Still there?'),
      ),
      { priority: 10 },
    )
    const second = await createFlow(
      w.owner,
      'Second',
      chain(keyword('help'), text('s', 'second')),
      {
        priority: 20,
      },
    )
    const phone = customer()
    await inbound(w, phone, 'help')
    const [waiting] = await executionsWhere(w.owner, first, (e) => e.status === 'WAITING')
    const conv = await waitFor(
      async () =>
        (
          (await w.owner.client.get('/conversations?view=all')).body.data as Array<{
            id: string
            contact: { phoneE164: string }
          }>
        ).find((c) => c.contact.phoneE164 === `+${phone}`),
      (c) => !!c,
    )
    const reply = await w.owner.client.post(
      `/conversations/${conv!.id}/messages`,
      { content: { type: 'TEXT', text: 'Hi, I am a human' } },
      { 'Idempotency-Key': `r-${metaId()}` },
    )
    expect(reply.status, reply.text).toBe(201)
    const stopped = await waitFor(
      () => execution(w.owner, waiting!.id),
      (e) => e.status === 'STOPPED_TAKEOVER',
    )
    expect(stopped.errorCode).toBe('AGENT_TAKEOVER')
    expect(stopped.steps!.at(-1)).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
    })
    const r = await run(w.owner, first, waiting!.triggerRunId!)
    expect(r).toMatchObject({ status: 'STOPPED', stopReason: 'AGENT_TAKEOVER' })
    expect(r.plan.map((p) => p.status)).toEqual(['STOPPED_TAKEOVER', 'SKIPPED_TAKEOVER'])
    expect(await executions(w.owner, second)).toHaveLength(0)
    // Waking the stopped execution does nothing (no resume after takeover).
    await dueNow(db, w.owner.tenantId, waiting!.id).catch(() => undefined)
    expect(await exec().run(w.owner.tenantId, waiting!.id)).toBe('inactive')
    // While in takeover, new messages start nothing: the run is stopped up front.
    await inbound(w, phone, 'help')
    await new Promise((r) => setTimeout(r, 1500))
    expect(await executions(w.owner, first)).toHaveLength(1)
    expect((await automationMessages(db, w.owner.tenantId)).map(textOf)).toEqual(['One moment'])
  })

  it('P10-D2: takeover found at a step (before the send) also stops the execution', async () => {
    const w = await workspace('auto-takeover-step')
    const flowId = await createFlow(
      w.owner,
      'Delayed',
      chain(keyword('later'), delay('wait'), text('after', 'after the delay')),
    )
    await inbound(w, customer(), 'later')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'WAITING')
    // The state changes without an event (e.g. a race): the next step sees it.
    await db.withTenant(w.owner.tenantId, async (tx) => {
      const x = await tx.automationExecution.findFirstOrThrow({ where: { id: e!.id } })
      await tx.conversation.update({
        where: { id: x.conversationId! },
        data: { automationState: 'AUTOMATION_PAUSED' },
      })
    })
    await dueNow(db, w.owner.tenantId, e!.id)
    await exec().run(w.owner.tenantId, e!.id)
    const after = await execution(w.owner, e!.id)
    expect(after).toMatchObject({ status: 'STOPPED_TAKEOVER', errorCode: 'AUTOMATION_PAUSED' })
    expect(await automationMessages(db, w.owner.tenantId)).toHaveLength(0)
  })

  it('a new version never changes executions already waiting on the old one', async () => {
    const w = await workspace('auto-version')
    const graph = (v: string) =>
      chain(keyword('ver'), text('a', `${v} before`), delay('d'), text('b', `${v} after`))
    const flowId = await createFlow(w.owner, 'Versioned', graph('v1'))
    await inbound(w, customer(), 'ver')
    const [old] = await executionsWhere(w.owner, flowId, (e) => e.status === 'WAITING')
    await saveDraft(w.owner, flowId, graph('v2'))
    expect((await publish(w.owner, flowId)).status).toBe(200)
    await inbound(w, customer(), 'ver')
    const both = await executionsWhere(w.owner, flowId, (e) => e.status === 'WAITING', 2)
    const fresh = both.find((e) => e.id !== old!.id)!
    expect(fresh.flowVersionId).not.toBe(old!.flowVersionId)
    await dueNow(db, w.owner.tenantId, old!.id)
    await exec().run(w.owner.tenantId, old!.id)
    expect((await execution(w.owner, old!.id)).status).toBe('COMPLETED')
    const texts = (await automationMessages(db, w.owner.tenantId)).map(textOf)
    expect(texts).toEqual(['v1 before', 'v2 before', 'v1 after'])
    const versions = (await w.owner.client.get(`/flows/${flowId}/versions`)).body.data
    expect(versions.map((v: { version: number; state: string }) => [v.version, v.state])).toEqual([
      [2, 'PUBLISHED'],
      [1, 'ARCHIVED'],
    ])
  })

  it('recovery: Redis loses the delayed job → X16 re-enqueues; duplicate workers never duplicate a step', async () => {
    const w = await workspace('auto-recover')
    const flowId = await createFlow(
      w.owner,
      'Recoverable',
      chain(keyword('recover'), delay('d'), text('after', 'recovered once')),
    )
    await inbound(w, customer(), 'recover')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'WAITING')
    // Simulate Redis loss: drop every job of this execution.
    const q = new Queue(QUEUES.automationExecute, { connection: { url: process.env.REDIS_URL! } })
    for (const job of await q.getJobs(['delayed', 'waiting']))
      if ((job.data as { executionId?: string }).executionId === e!.id) await job.remove()
    await q.close()
    await dueNow(db, w.owner.tenantId, e!.id)
    // Two recovery passes and two workers racing on the same execution.
    await Promise.all([exec().recover(), exec().recover()])
    await Promise.all([exec().run(w.owner.tenantId, e!.id), exec().run(w.owner.tenantId, e!.id)])
    const done = await waitFor(
      () => execution(w.owner, e!.id),
      (x) => x.status === 'COMPLETED',
    )
    const seqs = done.steps!.map((s) => s.seq)
    expect(seqs).toEqual([...new Set(seqs)])
    expect(done.steps!.filter((s) => s.nodeId === 'after')).toHaveLength(1)
    expect((await automationMessages(db, w.owner.tenantId)).map(textOf)).toEqual(['recovered once'])
  })

  it('duplicate trigger delivery creates one run and one execution', async () => {
    const w = await workspace('auto-dup')
    const flowId = await createFlow(w.owner, 'Once', chain(keyword('dup'), text('s', 'only once')))
    await inbound(w, customer(), 'dup')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'COMPLETED')
    const r = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.automationTriggerRun.findFirstOrThrow({ where: { id: e!.triggerRunId! } }),
    )
    const msg = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.findFirstOrThrow({ where: { direction: 'INBOUND' } }),
    )
    const job = {
      eventId: r.eventId,
      eventType: 'message.inbound.received' as const,
      tenantId: w.owner.tenantId,
      correlationId: null,
      occurredAt: new Date().toISOString(),
      payload: { messageId: msg.id, conversationId: msg.conversationId, contactId: msg.contactId },
    }
    const trigger = worker.get(AutomationTriggerProcessor)
    expect(await trigger.onMessage(job)).toBe('duplicate')
    await Promise.all([trigger.onMessage(job), trigger.onMessage(job)]).catch(() => undefined)
    await new Promise((res) => setTimeout(res, 1000))
    expect(await executions(w.owner, flowId)).toHaveLength(1)
    expect(await automationMessages(db, w.owner.tenantId)).toHaveLength(1)
  })

  it('keyword flows take precedence over "message received" flows', async () => {
    const w = await workspace('auto-precedence')
    const kw = await createFlow(w.owner, 'Keyword', chain(keyword('menu'), text('s', 'menu')))
    const any = await createFlow(
      w.owner,
      'Any message',
      chain({ id: 'trigger', type: 'trigger.message_received', config: {} }, text('s', 'any')),
    )
    await inbound(w, customer(), 'menu')
    await inbound(w, customer(), 'something else')
    await executionsWhere(w.owner, kw, (e) => e.status === 'COMPLETED')
    await executionsWhere(w.owner, any, (e) => e.status === 'COMPLETED')
    await new Promise((r) => setTimeout(r, 1000))
    expect(await executions(w.owner, kw)).toHaveLength(1)
    expect(await executions(w.owner, any)).toHaveLength(1)
  })

  it('re-entry policies: AFTER_COMPLETION, ONCE_PER_CONTACT, ALWAYS', async () => {
    const w = await workspace('auto-reentry')
    const after = await createFlow(w.owner, 'After', chain(keyword('re'), delay('d')), {
      reentryPolicy: 'AFTER_COMPLETION',
      priority: 1,
    })
    const once = await createFlow(w.owner, 'Once', chain(keyword('re')), {
      reentryPolicy: 'ONCE_PER_CONTACT',
      priority: 2,
    })
    const always = await createFlow(w.owner, 'Always', chain(keyword('re')), {
      reentryPolicy: 'ALWAYS',
      priority: 3,
    })
    const phone = customer()
    await inbound(w, phone, 're')
    const [first] = await executionsWhere(w.owner, after, (e) => e.status === 'WAITING')
    // The first run waits on "After" (AE3), so cancel it to let the run continue.
    expect((await w.owner.client.post(`/executions/${first!.id}/cancel`)).status).toBe(200)
    await executionsWhere(w.owner, once, (e) => e.status === 'COMPLETED')
    await executionsWhere(w.owner, always, (e) => e.status === 'COMPLETED')
    // Second message: "After" may start again (nothing active), "Once" is skipped.
    await inbound(w, phone, 're')
    const [second] = await waitFor(
      () => executions(w.owner, after),
      (l) => l.length === 2 && l[0]!.status === 'WAITING',
    )
    // Third while "After" is still waiting: skipped with the reason.
    await inbound(w, phone, 're')
    await waitFor(
      () => executions(w.owner, always),
      (l) => l.length === 2 && l.every(terminal),
    )
    const runs = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.automationTriggerRun.findMany({ orderBy: { createdAt: 'asc' } }),
    )
    expect(runs).toHaveLength(3)
    const plans = runs.map((r) =>
      (r.plan as Array<{ status: string; reason: string | null }>).map((p) => p.reason ?? p.status),
    )
    expect(plans[0]).toEqual(['CANCELLED', 'COMPLETED', 'COMPLETED'])
    expect(plans[1]).toEqual(['STARTED', 'PENDING', 'PENDING'])
    expect(plans[2]).toEqual(['REENTRY_ACTIVE_EXECUTION', 'REENTRY_ONCE_PER_CONTACT', 'COMPLETED'])
    expect(second!.status).toBe('WAITING')
  })

  it('the loop guard stops an execution at 500 steps with FLOW_STEP_LIMIT', async () => {
    const w = await workspace('auto-loop')
    const t = await tag(w, 'loop')
    const graph: Graph = {
      nodes: [
        keyword('loop'),
        { id: 'tag', type: 'action.add_tag', config: { tagIds: [t.id] } },
        delay('d'),
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'tag', sourceHandle: 'next' },
        { id: '2', source: 'tag', target: 'd', sourceHandle: 'next' },
        { id: '3', source: 'd', target: 'tag', sourceHandle: 'next' },
      ],
      layout: {},
    }
    const flowId = await createFlow(w.owner, 'Loop', graph)
    await inbound(w, customer(), 'loop')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'WAITING')
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.automationExecution.update({
        where: { id: e!.id },
        data: { stepCount: 500, waitUntil: new Date(Date.now() - 1000) },
      }),
    )
    await exec().run(w.owner.tenantId, e!.id)
    expect(await execution(w.owner, e!.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'FLOW_STEP_LIMIT',
    })
  })

  it('a paused flow keeps waiting executions waiting; resume lets them finish', async () => {
    const w = await workspace('auto-pause')
    const flowId = await createFlow(
      w.owner,
      'Pausable',
      chain(keyword('p'), delay('d'), text('s', 'resumed')),
    )
    await inbound(w, customer(), 'p')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'WAITING')
    expect((await w.owner.client.post(`/flows/${flowId}/pause`)).body.data.status).toBe('PAUSED')
    await inbound(w, customer(), 'p') // no new execution while paused
    await dueNow(db, w.owner.tenantId, e!.id)
    expect(await exec().run(w.owner.tenantId, e!.id)).toBe('flow-paused')
    const still = await execution(w.owner, e!.id)
    expect(still.status).toBe('WAITING')
    expect((await w.owner.client.post(`/flows/${flowId}/resume`)).body.data.status).toBe('ACTIVE')
    await dueNow(db, w.owner.tenantId, e!.id)
    await exec().run(w.owner.tenantId, e!.id)
    expect((await execution(w.owner, e!.id)).status).toBe('COMPLETED')
    expect(await executions(w.owner, flowId)).toHaveLength(1)
  })

  it('contact created trigger and DB actions (tag, update contact) commit with their step', async () => {
    const w = await workspace('auto-contact')
    const t = await tag(w, 'new')
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.contactPropertyDefinition.create({
        data: { tenantId: w.owner.tenantId, key: 'tier', label: 'Tier', type: 'TEXT' },
      }),
    )
    const graph = chain(
      { id: 'trigger', type: 'trigger.contact_created', config: { sources: ['MANUAL'] } },
      { id: 'tag', type: 'action.add_tag', config: { tagIds: [t.id] } },
      {
        id: 'upd',
        type: 'action.update_contact',
        config: {
          updates: [
            { field: 'property.tier', value: 'gold' },
            { field: 'language', value: 'en' },
          ],
        },
      },
    )
    const flowId = await createFlow(w.owner, 'Onboard', graph)
    const phone = customer()
    const created = await w.owner.client.post('/contacts', { phone: `+${phone}`, name: 'Grace' })
    expect(created.status, created.text).toBe(201)
    await executionsWhere(w.owner, flowId, (e) => e.status === 'COMPLETED')
    expect(await contactTags(w, phone)).toEqual([t.id])
    const contact = (await w.owner.client.get(`/contacts/${created.body.data.id}`)).body.data
    expect(contact.language).toBe('en')
    expect(contact.properties.tier).toBe('gold')
  })

  it('P10-D4: webhook action to the dev receiver; SSRF targets follow the error branch', async () => {
    const w = await workspace('auto-webhook')
    const ok = await tag(w, 'ok')
    const blocked = await tag(w, 'blocked')
    const graph = (url: string): Graph => ({
      nodes: [
        keyword('hook'),
        {
          id: 'call',
          type: 'action.webhook',
          config: {
            method: 'POST',
            url,
            headers: { Authorization: 'Bearer top-secret', 'X-Source': 'fenwira' },
            body: '{"phone":"{{contact.phone}}"}',
            timeoutMs: 3000,
            saveResponseAs: 'crm',
          },
        },
        {
          id: 'vip',
          type: 'condition.equals',
          config: { subject: '{{vars.crm.body.tier}}', value: 'vip' },
        },
        { id: 'tag-ok', type: 'action.add_tag', config: { tagIds: [ok.id] } },
        { id: 'tag-bad', type: 'action.add_tag', config: { tagIds: [blocked.id] } },
        end('e1'),
        end('e2'),
        end('e3'),
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'call', sourceHandle: 'next' },
        { id: '2', source: 'call', target: 'vip', sourceHandle: 'next' },
        { id: '3', source: 'call', target: 'tag-bad', sourceHandle: 'error' },
        { id: '4', source: 'vip', target: 'tag-ok', sourceHandle: 'yes' },
        { id: '5', source: 'vip', target: 'e1', sourceHandle: 'no' },
        { id: '6', source: 'tag-ok', target: 'e2', sourceHandle: 'next' },
        { id: '7', source: 'tag-bad', target: 'e3', sourceHandle: 'next' },
      ],
      layout: {},
    })
    const good = await createFlow(w.owner, 'Hook ok', graph(`${receiverUrl}/crm?token=abc`), {
      priority: 1,
    })
    const phone = customer()
    await inbound(w, phone, 'hook')
    const [e] = await executionsWhere(w.owner, good, (x) => x.status === 'COMPLETED')
    const d = await execution(w.owner, e!.id)
    expect(d.steps!.map((s) => s.nodeId)).toEqual(['trigger', 'call', 'vip', 'tag-ok', 'e2'])
    const hit = received.find((r) => r.path.startsWith('/crm'))!
    expect(hit.headers['idempotency-key']).toBe(`auto:${e!.id}:2`)
    expect(hit.headers.authorization).toBe('Bearer top-secret')
    expect(JSON.parse(hit.body)).toEqual({ phone: `+${phone}` })
    // Secrets never reach history.
    const input = d.steps![1]!.input as { headers: Record<string, string>; url: string }
    expect(input.headers).toEqual({ Authorization: '[REDACTED]', 'X-Source': 'fenwira' })
    expect(input.url).toContain('token=%5BREDACTED%5D')
    expect(await contactTags(w, phone)).toEqual([ok.id])

    // Blocked destinations (not the dev host): error branch with the reason recorded.
    await w.owner.client.post(`/flows/${good}/pause`)
    for (const [i, url] of [
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/admin',
      'http://example.com/plain-http',
      `${receiverUrl}/fail`,
    ].entries()) {
      const id = await createFlow(w.owner, `Hook bad ${i}`, graph(url), { priority: 10 + i })
      void id
    }
    const other = customer()
    await inbound(w, other, 'hook')
    const flows = (await w.owner.client.get('/flows')).body.data.filter((f: { name: string }) =>
      f.name.startsWith('Hook bad'),
    )
    const codes: string[] = []
    for (const f of flows) {
      const [x] = await executionsWhere(w.owner, f.id, (y) => y.status === 'COMPLETED')
      codes.push((await execution(w.owner, x!.id)).steps![1]!.errorCode!)
    }
    expect(codes).toEqual([
      'WEBHOOK_BLOCKED_DESTINATION',
      'WEBHOOK_BLOCKED_DESTINATION',
      'WEBHOOK_URL_INVALID',
      'WEBHOOK_HTTP_ERROR',
    ])
    expect(await contactTags(w, other)).toEqual([blocked.id])
  })

  it('inbound webhook trigger: token + HMAC → 202 with the execution; idempotent; bad signature 401', async () => {
    const w = await workspace('auto-inhook')
    const graph = chain(
      {
        id: 'trigger',
        type: 'trigger.webhook',
        config: { contactPhonePath: 'customer.phone', requireSignature: true },
      },
      text('s', 'Order {{trigger.webhook.order.id}} confirmed'),
    )
    const flowId = await createFlow(w.owner, 'Inbound hook', graph)
    const tok = (await w.owner.client.post(`/flows/${flowId}/webhook-token`)).body.data
    expect(tok.url).toContain(`/api/v1/webhooks/automation/${tok.token}`)
    const phone = customer()
    const body = JSON.stringify({ customer: { phone: `+${phone}` }, order: { id: 'A-77' } })
    const sign = (b: string) => `sha256=${createHmac('sha256', tok.secret).update(b).digest('hex')}`
    const post = (headers: Record<string, string>, token = tok.token, b = body) =>
      fetch(`${apiUrl}/api/v1/webhooks/automation/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: b,
      })
    expect((await post({ 'X-Fenwira-Signature': 'sha256=deadbeef' })).status).toBe(401)
    expect((await post({})).status).toBe(401)
    expect((await post({ 'X-Fenwira-Signature': sign(body) }, 'x'.repeat(43))).status).toBe(404)
    const first = await post({ 'X-Fenwira-Signature': sign(body), 'Idempotency-Key': 'order-A-77' })
    expect(first.status).toBe(202)
    const out = ((await first.json()) as { data: { executionId: string } }).data
    expect(out.executionId).toBeTruthy()
    const again = await post({ 'X-Fenwira-Signature': sign(body), 'Idempotency-Key': 'order-A-77' })
    expect(((await again.json()) as { data: { executionId: string } }).data.executionId).toBe(
      out.executionId,
    )
    // Eligibility is still MessagingService's: a new contact has no open service window.
    const refused = await waitFor(
      () => execution(w.owner, out.executionId),
      (e) => e.status === 'FAILED',
    )
    expect(refused.errorCode).toBe('CONVERSATION_WINDOW_CLOSED')
    // Once the customer writes, the same flow can reply.
    await inbound(w, phone, 'hi there')
    await waitFor(
      () =>
        db.withTenant(w.owner.tenantId, (tx) =>
          tx.message.count({
            where: { direction: 'INBOUND', contact: { phoneE164: `+${phone}` } },
          }),
        ),
      (n) => n === 1,
    )
    const second = await post({
      'X-Fenwira-Signature': sign(body),
      'Idempotency-Key': 'order-A-78',
    })
    const next = ((await second.json()) as { data: { executionId: string } }).data
    expect(next.executionId).not.toBe(out.executionId)
    await waitFor(
      () => execution(w.owner, next.executionId),
      (e) => e.status === 'COMPLETED',
    )
    const msgs = await automationMessages(db, w.owner.tenantId)
    expect(msgs.map(textOf)).toEqual(['Order A-77 confirmed'])
    // Rotating the token invalidates the old one.
    await w.owner.client.post(`/flows/${flowId}/webhook-token`)
    expect((await post({ 'X-Fenwira-Signature': sign(body) })).status).toBe(404)
  })

  it('validation blocks publishing with pinpointed nodes; drafts use optimistic concurrency', async () => {
    const w = await workspace('auto-validate')
    const created = await w.owner.client.post('/flows', { name: 'Broken' })
    const id = created.body.data.id
    const draft = (await w.owner.client.get(`/flows/${id}/draft`)).body.data
    const broken = {
      nodes: [keyword('x'), { id: 'send', type: 'action.send_message', config: {} }, end('lonely')],
      edges: [{ id: '1', source: 'trigger', target: 'send', sourceHandle: 'next' }],
      layout: {},
    }
    const saved = await w.owner.client.put(
      `/flows/${id}/draft`,
      { graph: broken },
      { 'If-Match': draft.etag },
    )
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.data.validation.valid).toBe(false)
    // A stale etag is a conflict; a missing one is refused.
    const stale = await w.owner.client.put(
      `/flows/${id}/draft`,
      { graph: broken },
      { 'If-Match': draft.etag },
    )
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
    expect((await w.owner.client.put(`/flows/${id}/draft`, { graph: broken })).status).toBe(400)
    const pub = await publish(w.owner, id)
    expect(pub.status).toBe(422)
    expect(pub.body.error.code).toBe('FLOW_INVALID')
    const errs = pub.body.error.details.errors as Array<{ code: string; nodeId?: string }>
    expect(errs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FLOW_NODE_CONFIG_INVALID', nodeId: 'send' }),
      ]),
    )
    // Server reference checks: a tag that doesn't exist.
    const ref = chain(keyword('x'), {
      id: 'tag',
      type: 'action.add_tag',
      config: { tagIds: [crypto.randomUUID()] },
    })
    await saveDraft(w.owner, id, ref)
    const v = (await w.owner.client.post(`/flows/${id}/validate`)).body.data
    expect(v.errors).toEqual([
      expect.objectContaining({ code: 'FLOW_REFERENCE_MISSING', nodeId: 'tag' }),
    ])
  })

  it('P10-D3: entitlements gate publishing and execution start (allow-all by default)', async () => {
    const w = await workspace('auto-entitle')
    const flowId = await createFlow(w.owner, 'Limited', chain(keyword('lim'), text('s', 'hi')))
    const wEnt = worker.get(EntitlementsService)
    const aEnt = api.get(EntitlementsService)
    try {
      wEnt.useSource({ enabled: async () => true, limit: async () => 0 })
      await inbound(w, customer(), 'lim')
      const r = await waitFor(
        () => db.withTenant(w.owner.tenantId, (tx) => tx.automationTriggerRun.findFirst({})),
        (x) => !!x && x.status === 'COMPLETED',
      )
      expect((r!.plan as Array<{ status: string; reason: string }>)[0]).toMatchObject({
        status: 'SKIPPED_ENTITLEMENT',
        reason: 'automation_execution_limit',
      })
      aEnt.useSource({ enabled: async () => false, limit: async () => null })
      const second = await createFlow(w.owner, 'Nope', chain(keyword('no')), { publish: false })
      const refused = await publish(w.owner, second)
      expect(refused.status).toBe(403)
      expect(refused.body.error).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
      expect(await executions(w.owner, flowId)).toHaveLength(0)
    } finally {
      const all = { enabled: async () => true, limit: async () => null }
      wEnt.useSource(all)
      aEnt.useSource(all)
    }
  })

  it('tenant isolation: another workspace sees 404 and cannot trigger or cancel', async () => {
    const a = await workspace('auto-iso-a')
    const b = await workspace('auto-iso-b')
    const flowId = await createFlow(a.owner, 'Private', chain(keyword('secret'), delay('d')))
    await inbound(a, customer(), 'secret')
    const [e] = await executionsWhere(a.owner, flowId, (x) => x.status === 'WAITING')
    for (const res of [
      await b.owner.client.get(`/flows/${flowId}`),
      await b.owner.client.get(`/flows/${flowId}/draft`),
      await b.owner.client.get(`/flows/${flowId}/executions`),
      await b.owner.client.get(`/executions/${e!.id}`),
      await b.owner.client.post(`/executions/${e!.id}/cancel`),
      await publish(b.owner, flowId),
      await b.owner.client.post(`/flows/${flowId}/pause`),
      await b.owner.client.post(`/flows/${flowId}/webhook-token`),
    ])
      expect(res.status).toBe(404)
    // B's customers sending A's keyword to B's number start nothing in A.
    await inbound(b, customer(), 'secret')
    await new Promise((r) => setTimeout(r, 1500))
    expect(await executions(a.owner, flowId)).toHaveLength(1)
    expect((await execution(a.owner, e!.id)).status).toBe('WAITING')
    // A viewer can read history but customer data is redacted.
    const viewer = await addMember(api, a.owner, 'VIEWER')
    const seen = (await viewer.client.get(`/executions/${e!.id}`)).body.data
    expect(seen.steps[0].output).toBeDefined()
  })
})

describe('Phase 10: template sends', { timeout: 120_000 }, () => {
  it('send_template resolves the approved version at run time', async () => {
    const w = await campaignWorld(api, mock.url, 'auto-template')
    const tmpl = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.template.findFirstOrThrow({ where: { name: 'order_update' } }),
    )
    const graph = chain(keyword('status'), {
      id: 't',
      type: 'action.send_template',
      config: {
        templateId: tmpl.id,
        variables: { body: ['{{contact.firstName}}', '#{{trigger.message.text}}'] },
      },
    })
    const flowId = await createFlow(w.owner, 'Template', graph)
    await inbound(w, customer(), 'status')
    const [e] = await executionsWhere(w.owner, flowId, (x) => x.status === 'COMPLETED')
    const d = await execution(w.owner, e!.id)
    expect(d.steps![1]!.input).toMatchObject({
      templateVersionId: w.utility.versionId,
      variables: { body: ['Ada', '#status'] },
    })
  })
})
