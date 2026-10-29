import { makeTestPdf, type MockProvider } from '@fenwira/ai'
import { AI_PROVIDER, searchChunks } from '@fenwira/api/modules/ai'
import { AutomationExecuteProcessor } from '@fenwira/api/modules/automation'
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
  createFlow,
  delay,
  dueNow,
  end,
  execution,
  type Exec,
  executionsWhere,
  type Graph,
  textOf,
} from './support/automation'
import { metaId, waitFor } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * AI Assistant (docs/AI_ASSISTANT.md) against the mock model provider (AI_PROVIDER=mock, the
 * default), the in-process meta-mock and the compose Postgres (pgvector) / Redis / MinIO.
 */
const SECRET = 'ai-test-secret'
const HANDOFF = 'A teammate will take it from here.'
const FALLBACK = 'Sorry, I could not find that. Could you rephrase?'
const HOURS =
  'Anna Bakery is open on weekdays from 9am to 6pm. On Saturday the opening hours are 10am to 2pm.'
const QUESTION = 'What are the opening hours on weekdays?'

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

type Ws = { owner: Member; ids: { wabaId: string; phoneNumberId: string } }
const tenant = (w: Ws) => w.owner.tenantId
const customer = () => `9196${String(Math.random()).slice(2, 10)}`
const model = () => worker.get<MockProvider>(AI_PROVIDER)
const exec = () => worker.get(AutomationExecuteProcessor)

async function workspace(label: string, ai = true, quota = 100): Promise<Ws> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await fetch(`${mock.url}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] }),
  })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  if (ai) await setAi({ owner, ids }, { enabled: true, monthlyMessageQuota: quota })
  return { owner, ids }
}

const setAi = (w: Ws, data: { enabled?: boolean; monthlyMessageQuota?: number }) =>
  db.withTenant(tenant(w), (tx) =>
    tx.aiSettings.upsert({
      where: { tenantId: tenant(w) },
      create: { tenantId: tenant(w), ...data, handoffMessage: HANDOFF, fallbackMessage: FALLBACK },
      update: data,
    }),
  )

const inbound = (w: Ws, from: string, body: string) =>
  deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text: body, name: 'Ada' }),
  )

async function addText(w: Ws, title: string, text: string): Promise<string> {
  const res = await w.owner.client.post('/ai/knowledge/text', { title, text })
  expect(res.status, res.text).toBe(201)
  await sourceWhere(w, res.body.data.id, (s) => s.status === 'READY')
  return res.body.data.id
}

type Source = { id: string; status: string; failureReason: string | null; chunkCount: number }
const sourceWhere = (w: Ws, id: string, done: (s: Source) => boolean) =>
  waitFor(
    async () =>
      ((await w.owner.client.get('/ai/knowledge')).body.data as Source[]).find((s) => s.id === id),
    (s) => !!s && done(s),
    30_000,
  ) as Promise<Source>

async function uploadPdf(w: Ws, pdf: Uint8Array, filename: string): Promise<string> {
  const up = await w.owner.client.post('/ai/knowledge/upload-url', {
    mimeType: 'application/pdf',
    sizeBytes: pdf.length,
    filename,
  })
  expect(up.status, up.text).toBe(201)
  const put = await fetch(up.body.data.url, {
    method: 'PUT',
    headers: up.body.data.headers,
    body: Buffer.from(pdf),
  })
  expect(put.ok).toBe(true)
  const created = await w.owner.client.post('/ai/knowledge/files', { fileId: up.body.data.fileId })
  expect(created.status, created.text).toBe(201)
  return created.body.data.id
}

const conversationOf = (w: Ws, from: string) =>
  waitFor(
    () =>
      db.withTenant(tenant(w), async (tx) => {
        const c = await tx.contact.findFirst({ where: { phoneE164: `+${from}` } })
        return c ? tx.conversation.findFirst({ where: { contactId: c.id } }) : null
      }),
    (c) => !!c,
  ).then((c) => c!)

const aiMessages = (w: Ws, conversationId: string) =>
  db.withTenant(tenant(w), (tx) =>
    tx.message.findMany({
      where: { conversationId, aiGenerated: true },
      orderBy: { createdAt: 'asc' },
    }),
  )

const usageRows = (w: Ws, kind: 'REPLY' | 'EMBEDDING', runId?: string) =>
  db.withTenant(tenant(w), (tx) =>
    tx.aiUsage.count({ where: { kind, ...(runId ? { runId } : {}) } }),
  )

const messageReceived = { id: 'trigger', type: 'trigger.message_received', config: {} }
const aiFlow = (mode: 'SINGLE' | 'CONVERSATION'): Graph => ({
  nodes: [
    messageReceived,
    { id: 'ai', type: 'action.ai_reply', config: { mode } },
    end('e1'),
    end('e2'),
    end('e3'),
  ],
  edges: [
    { id: '1', source: 'trigger', target: 'ai', sourceHandle: 'next' },
    { id: '2', source: 'ai', target: 'e1', sourceHandle: 'replied' },
    { id: '3', source: 'ai', target: 'e2', sourceHandle: 'needs_human' },
    { id: '4', source: 'ai', target: 'e3', sourceHandle: 'error' },
  ],
  layout: {},
})

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
    AI_PLAYGROUND_PER_MINUTE: '100',
  })
  await api.listen(0)
  const apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: [], delayMs: 20 }
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('AI Assistant: knowledge and answers', { timeout: 120_000 }, () => {
  it('is closed to workspaces without AI enabled (structured error)', async () => {
    const w = await workspace('ai-off', false)
    const res = await w.owner.client.get('/ai/overview')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('AI_NOT_ENABLED')
  })

  it('ingests a text PDF with page numbers; a scanned PDF fails with a clear reason', async () => {
    const w = await workspace('ai-ingest')
    const id = await uploadPdf(w, makeTestPdf(['Welcome to Anna Bakery.', HOURS]), 'hours.pdf')
    const ready = await sourceWhere(w, id, (s) => s.status !== 'PROCESSING')
    expect(ready).toMatchObject({ status: 'READY', failureReason: null })
    expect(ready.chunkCount).toBeGreaterThan(0)
    expect(await usageRows(w, 'EMBEDDING')).toBeGreaterThan(0)
    const pg = await w.owner.client.post('/ai/playground', { question: QUESTION })
    expect(pg.body.data.outcome).toBe('REPLIED')
    expect(pg.body.data.sources[0]).toMatchObject({ documentTitle: 'hours', page: 2 })

    const scanned = await uploadPdf(w, makeTestPdf(['', '']), 'scan.pdf')
    expect(await sourceWhere(w, scanned, (s) => s.status !== 'PROCESSING')).toMatchObject({
      status: 'FAILED',
      failureReason: 'This PDF looks scanned. Upload a text-based version.',
    })
  })

  it('playground: answer with sources; out of scope is no_answer without a model call', async () => {
    const w = await workspace('ai-play')
    await addText(w, 'Hours', HOURS)
    const ok = await w.owner.client.post('/ai/playground', { question: QUESTION })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.data).toMatchObject({ outcome: 'REPLIED' })
    expect(ok.body.data.answer).toContain('9am to 6pm')
    expect(ok.body.data.sources[0].documentTitle).toBe('Hours')
    const before = model().calls.converse.length
    const none = await w.owner.client.post('/ai/playground', {
      question: 'Do you repair bicycles?',
    })
    expect(none.body.data).toMatchObject({ outcome: 'NO_ANSWER', answer: FALLBACK, sources: [] })
    expect(model().calls.converse.length).toBe(before)
    const usage = (await w.owner.client.get('/ai/usage')).body.data
    expect(usage).toMatchObject({ used: 1, quota: 100 })
  })

  it('retrieval never returns another workspace’s chunks (query filter and RLS)', async () => {
    const a = await workspace('ai-iso-a')
    const b = await workspace('ai-iso-b')
    await addText(a, 'Hours', HOURS)
    await addText(b, 'Secret pricing', 'Secret pricing: the gold plan costs 999 rupees per month.')
    const asked = await a.owner.client.post('/ai/playground', {
      question: 'What does the gold plan cost per month?',
    })
    expect(asked.body.data.outcome).toBe('NO_ANSWER')
    expect(JSON.stringify(asked.body.data)).not.toContain('Secret')
    const v = model().vector('gold plan cost per month')
    const dim = v.length
    // Bound to A, filtering for B: nothing (RLS). Bound to B, filtering for A: nothing (filter).
    expect(await db.withTenant(tenant(a), (tx) => searchChunks(tx, tenant(b), v, 5, dim))).toEqual(
      [],
    )
    expect(await db.withTenant(tenant(b), (tx) => searchChunks(tx, tenant(a), v, 5, dim))).toEqual(
      [],
    )
    const own = await db.withTenant(tenant(b), (tx) => searchChunks(tx, tenant(b), v, 5, dim))
    expect(own[0]?.title).toBe('Secret pricing')
  })
})

describe('AI Assistant: the AI reply step', { timeout: 180_000 }, () => {
  it('retry-safe: a re-run step reuses the saved reply (one model call, one send, one usage row)', async () => {
    const w = await workspace('ai-retry')
    await addText(w, 'Hours', HOURS)
    const flowId = await createFlow(w.owner, 'AI single', aiFlow('SINGLE'))
    const from = customer()
    await inbound(w, from, QUESTION)
    const [done] = await executionsWhere(w.owner, flowId, (e) => e.status === 'COMPLETED')
    const detail = await execution(w.owner, done!.id)
    const step = detail.steps!.find((s) => s.nodeId === 'ai')!
    expect(step.status).toBe('SUCCEEDED')
    expect(detail.steps!.map((s) => s.nodeId)).toEqual(['trigger', 'ai', 'e1'])
    const c = await conversationOf(w, from)
    const msgs = await aiMessages(w, c.id)
    expect(msgs.map(textOf)).toEqual(['Anna Bakery is open on weekdays from 9am to 6pm.'])
    expect(msgs[0]!.idempotencyKey).toBe(`auto:${done!.id}:${step.seq}`)
    expect(await usageRows(w, 'REPLY', done!.id)).toBe(1)

    // A worker died after sending but before recording: phase 2 runs again for the same seq.
    const row = await db.withTenant(tenant(w), (tx) =>
      tx.automationExecution.findFirstOrThrow({ where: { id: done!.id } }),
    )
    const calls = model().calls.converse.length
    const again = await (
      exec() as unknown as {
        externalAi(e: unknown, p: unknown, seq: number, key: string): Promise<{ handle?: string }>
      }
    ).externalAi(
      { ...row, stepCount: step.seq - 1 },
      {
        kind: 'ai',
        conversationId: c.id,
        messageId: msgs[0]!.id,
        question: QUESTION,
        history: [],
        mode: 'SINGLE',
        instructions: null,
        input: {},
      },
      step.seq,
      `auto:${done!.id}:${step.seq}`,
    )
    expect(again.handle).toBe('replied')
    expect(model().calls.converse.length).toBe(calls)
    expect(await aiMessages(w, c.id)).toHaveLength(1)
    expect(await usageRows(w, 'REPLY', done!.id)).toBe(1)
    const logs = await db.withTenant(tenant(w), (tx) =>
      tx.aiReplyLog.findMany({ where: { runId: done!.id } }),
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ outcome: 'REPLIED', decided: true })
  })

  it('outside the 24-hour window the step takes its error path without calling the model', async () => {
    const w = await workspace('ai-window')
    await addText(w, 'Hours', HOURS)
    const graph = aiFlow('SINGLE')
    graph.nodes.splice(1, 0, delay('wait'))
    graph.edges[0] = { id: '1', source: 'trigger', target: 'wait', sourceHandle: 'next' }
    graph.edges.push({ id: '5', source: 'wait', target: 'ai', sourceHandle: 'next' })
    const flowId = await createFlow(w.owner, 'AI later', graph)
    const from = customer()
    await inbound(w, from, QUESTION)
    const [waiting] = await executionsWhere(w.owner, flowId, (e) => e.status === 'WAITING')
    const c = await conversationOf(w, from)
    await db.withTenant(tenant(w), (tx) =>
      tx.conversation.update({
        where: { id: c.id },
        data: { serviceWindowExpiresAt: new Date(Date.now() - 1000) },
      }),
    )
    const calls = model().calls.converse.length
    await dueNow(db, tenant(w), waiting!.id)
    await exec().run(tenant(w), waiting!.id)
    const detail = await execution(w.owner, waiting!.id)
    expect(detail.status).toBe('COMPLETED')
    expect(detail.steps!.find((s) => s.nodeId === 'ai')).toMatchObject({
      status: 'FAILED',
      errorCode: 'CONVERSATION_WINDOW_CLOSED',
    })
    expect(detail.steps!.at(-1)!.nodeId).toBe('e3')
    expect(model().calls.converse.length).toBe(calls)
    expect(await aiMessages(w, c.id)).toHaveLength(0)
  })
})

describe('AI Assistant: managed flow and conversation mode', { timeout: 240_000 }, () => {
  let w: Ws
  let flowId: string

  const aiRun = (from: string, done: (e: Exec) => boolean) =>
    conversationOf(w, from).then(async (c) =>
      waitFor(
        () =>
          db.withTenant(tenant(w), (tx) =>
            tx.automationExecution.findFirst({ where: { conversationId: c.id, flowId } }),
          ),
        (e) => !!e && done(e as unknown as Exec),
        30_000,
      ).then((e) => ({ c, e: e! })),
    )

  beforeAll(async () => {
    w = await workspace('ai-managed')
    await addText(w, 'Hours', HOURS)
  })

  it('turn on creates and publishes one managed flow; again reuses it; pause pauses it', async () => {
    const on = await w.owner.client.post('/ai/assistant/turn-on', {})
    expect(on.status, on.text).toBe(200)
    expect(on.body.data).toMatchObject({
      status: 'ACTIVE',
      priority: 900,
      managedBy: 'AI_ASSISTANT',
    })
    flowId = on.body.data.id
    const again = await w.owner.client.post('/ai/assistant/turn-on', {})
    expect(again.body.data.id).toBe(flowId)
    const flows = (await w.owner.client.get('/flows')).body.data as Array<{
      managedBy: string | null
    }>
    expect(flows.filter((f) => f.managedBy === 'AI_ASSISTANT')).toHaveLength(1)
    expect((await w.owner.client.post('/ai/assistant/pause', {})).body.data.status).toBe('PAUSED')
    const resumed = await w.owner.client.post('/ai/assistant/turn-on', {})
    expect(resumed.body.data).toMatchObject({ id: flowId, status: 'ACTIVE' })
    const overview = (await w.owner.client.get('/ai/overview')).body.data
    expect(overview.managedFlow).toEqual({ id: flowId, status: 'ACTIVE' })
  })

  it('conversation mode: each message resumes the same run; 24 h of silence ends it', async () => {
    const from = customer()
    await inbound(w, from, QUESTION)
    const { c, e } = await aiRun(from, (x) => x.status === 'WAITING')
    expect((await w.owner.client.get(`/conversations/${c.id}`)).body.data.aiHandling).toBe(true)
    await inbound(w, from, 'And the Saturday opening hours?')
    await waitFor(
      () => aiMessages(w, c.id),
      (m) => m.length === 2,
    )
    const same = await aiRun(from, (x) => x.status === 'WAITING' && x.id === e.id)
    expect(same.e.id).toBe(e.id)
    const sent = await aiMessages(w, c.id)
    expect(sent.map(textOf)[1]).toContain('Saturday')
    await dueNow(db, tenant(w), e.id)
    await exec().run(tenant(w), e.id)
    const detail = await execution(w.owner, e.id)
    expect(detail.status).toBe('COMPLETED')
    expect(detail.steps!.at(-2)).toMatchObject({ nodeId: 'ai', output: { ended: 'SILENCE' } })
    expect(detail.steps!.at(-1)!.nodeId).toBe('end-replied')
    expect((await w.owner.client.get(`/conversations/${c.id}`)).body.data.aiHandling).toBe(false)
  })

  it('resolving the conversation ends the run', async () => {
    const from = customer()
    await inbound(w, from, QUESTION)
    const { c, e } = await aiRun(from, (x) => x.status === 'WAITING')
    const res = await w.owner.client.post(`/conversations/${c.id}/status`, { status: 'RESOLVED' })
    expect(res.status, res.text).toBeLessThan(300)
    await aiRun(from, (x) => x.id === e.id && x.status === 'COMPLETED')
    const detail = await execution(w.owner, e.id)
    expect(detail.steps!.at(-1)!.output).toMatchObject({ ended: 'CONVERSATION_RESOLVED' })
  })

  it('two no-answers in a row hand off: handoff message, takeover, system event', async () => {
    const from = customer()
    await inbound(w, from, 'Do you repair bicycles?')
    const { c, e } = await aiRun(from, (x) => x.status === 'WAITING')
    expect((await aiMessages(w, c.id)).map(textOf)).toEqual([FALLBACK])
    await inbound(w, from, 'Can you fix my scooter tyre?')
    await aiRun(from, (x) => x.id === e.id && x.status === 'COMPLETED')
    expect((await aiMessages(w, c.id)).map(textOf)).toEqual([FALLBACK, HANDOFF])
    const conv = (await w.owner.client.get(`/conversations/${c.id}`)).body.data
    expect(conv).toMatchObject({ automationState: 'AGENT_TAKEOVER', aiHandling: false })
    const thread = (await w.owner.client.get(`/conversations/${c.id}/messages`)).body
      .data as Array<{
      content: { event?: string }
    }>
    expect(thread.some((m) => m.content.event === 'ai_handoff')).toBe(true)
    const detail = await execution(w.owner, e.id)
    expect(detail.steps!.map((s) => s.nodeId).slice(-2)).toEqual(['ai', 'end-human'])
  })

  it('human takeover stops a waiting AI conversation', async () => {
    const from = customer()
    await inbound(w, from, QUESTION)
    const { c, e } = await aiRun(from, (x) => x.status === 'WAITING')
    const res = await w.owner.client.post(`/conversations/${c.id}/automation-state`, {
      state: 'AGENT_TAKEOVER',
    })
    expect(res.status, res.text).toBeLessThan(300)
    await aiRun(from, (x) => x.id === e.id && x.status === 'STOPPED_TAKEOVER')
  })

  it('quota exhausted: no model call, the conversation is handed off', async () => {
    await setAi(w, { monthlyMessageQuota: 0 })
    const calls = model().calls.converse.length
    const from = customer()
    await inbound(w, from, QUESTION)
    const { c } = await aiRun(from, (x) => x.status === 'COMPLETED')
    expect(model().calls.converse.length).toBe(calls)
    expect((await aiMessages(w, c.id)).map(textOf)).toEqual([HANDOFF])
    const logs = await db.withTenant(tenant(w), (tx) =>
      tx.aiReplyLog.findMany({ where: { conversationId: c.id } }),
    )
    expect(logs.map((l) => l.outcome)).toEqual(['QUOTA'])
    await setAi(w, { monthlyMessageQuota: 100 })
  })
})
