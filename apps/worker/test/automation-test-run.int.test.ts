import { Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Graph, saveDraft } from './support/automation'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * Test run (docs/AUTOMATION_ENGINE.md → Test run): the draft runs in a rolled-back transaction.
 * Conditions and tag steps use the executor's handlers; nothing is sent, called or stored apart
 * from one `automation.tested` audit entry.
 */
let api: INestApplication
let worker: INestApplication
let db: Database
let owner: Member
let flowId: string
let vip: string
let lead: string

const graph = (): Graph => ({
  nodes: [
    {
      id: 'trigger',
      type: 'trigger.keyword',
      config: { keywords: ['price'], match: 'CONTAINS', caseSensitive: false },
    },
    { id: 'vip', type: 'condition.has_tag', config: { tagIds: [vip], match: 'ANY' } },
    { id: 'tag', type: 'action.add_tag', config: { tagIds: [lead] } },
    { id: 'assign', type: 'action.assign_agent', config: { mode: 'ROUND_ROBIN' } },
    { id: 'wait', type: 'action.delay', config: { amount: 1, unit: 'MINUTES' } },
    {
      id: 'replied',
      type: 'condition.contact_property',
      config: { key: 'lastInboundAt', operator: 'IN_LAST_DAYS', value: 1 },
    },
    { id: 'send', type: 'action.send_message', config: { text: 'Hi {{contact.firstName}}!' } },
    {
      id: 'hook',
      type: 'action.webhook',
      config: { method: 'POST', url: 'https://example.com/hook', timeoutMs: 5000 },
    },
    { id: 'end', type: 'action.end', config: {} },
    { id: 'end-no', type: 'action.end', config: {} },
    { id: 'end-replied', type: 'action.end', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'vip', sourceHandle: 'next' },
    { id: 'e2', source: 'vip', target: 'tag', sourceHandle: 'yes' },
    { id: 'e3', source: 'vip', target: 'end-no', sourceHandle: 'no' },
    { id: 'e4', source: 'tag', target: 'assign', sourceHandle: 'next' },
    { id: 'e5', source: 'assign', target: 'wait', sourceHandle: 'next' },
    { id: 'e6', source: 'wait', target: 'replied', sourceHandle: 'next' },
    { id: 'e7', source: 'replied', target: 'end-replied', sourceHandle: 'yes' },
    { id: 'e8', source: 'replied', target: 'send', sourceHandle: 'no' },
    { id: 'e9', source: 'send', target: 'hook', sourceHandle: 'next' },
    { id: 'e10', source: 'hook', target: 'end', sourceHandle: 'next' },
  ],
  layout: {},
})

/** Rows a real run would leave behind. */
const footprint = () =>
  db.withTenant(owner.tenantId, async (tx) => ({
    contacts: await tx.contact.count(),
    contactTags: await tx.contactTag.count(),
    activities: await tx.contactActivity.count(),
    messages: await tx.message.count(),
    executions: await tx.automationExecution.count(),
    steps: await tx.automationExecutionStep.count(),
    runs: await tx.automationTriggerRun.count(),
    outbox: await tx.outboxEvent.count(),
  }))

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
  db = api.get(Database)
  owner = await createOwner(api, 'flow-test')
  const tag = async (name: string) =>
    (await owner.client.post('/tags', { name, color: 'PRIMARY' })).body.data.id as string
  vip = await tag('vip')
  lead = await tag('lead')
  const created = await owner.client.post('/flows', { name: 'Dry run' })
  flowId = created.body.data.id
  await saveDraft(owner, flowId, graph())
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

describe('POST /flows/:id/test', () => {
  it('walks the path with real conditions and leaves nothing behind', async () => {
    const before = await footprint()
    const res = await owner.client.post(`/flows/${flowId}/test`, {
      contact: { name: 'Asha Rao', tagIds: [vip] },
      message: 'What is the price?',
    })
    expect(res.status, res.text).toBe(200)
    const r = res.body.data
    expect(r.matched).toBe(true)
    expect(r.steps.map((s: { nodeId: string }) => s.nodeId)).toEqual([
      'trigger',
      'vip',
      'tag',
      'assign',
      'wait',
      'replied',
      'send',
      'hook',
      'end',
    ])
    const by = (id: string) => r.steps.find((s: { nodeId: string }) => s.nodeId === id)
    expect(by('vip')).toMatchObject({
      mode: 'RAN',
      handle: 'yes',
      summary: 'Yes: the contact has the tag vip.',
    })
    expect(by('tag')).toMatchObject({ mode: 'RAN', summary: 'Would add the tag lead.' })
    expect(by('assign').mode).toBe('SIMULATED')
    expect(by('wait').summary).toBe('Would wait 1 minute, then continue (skipped in a test).')
    // A made-up contact never wrote in, so "replied in the last day" is No.
    expect(by('replied').handle).toBe('no')
    expect(by('send')).toMatchObject({ mode: 'SIMULATED', summary: 'Would send: “Hi Asha!”' })
    expect(by('hook').summary).toBe(
      'Would call POST https://example.com/hook (not called in a test).',
    )
    expect(await footprint()).toEqual(before)
    const audit = await db.withTenant(owner.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { action: 'automation.tested', targetId: flowId } }),
    )
    expect(audit).toHaveLength(1)
  })

  it('takes the No branch without the tag, explains non-matching samples, and checks phones', async () => {
    const no = await owner.client.post(`/flows/${flowId}/test`, { message: 'price please' })
    expect(no.body.data.steps.map((s: { nodeId: string }) => s.nodeId)).toEqual([
      'trigger',
      'vip',
      'end-no',
    ])
    expect(no.body.data.steps[1].summary).toBe('No: the contact doesn’t have any of vip.')
    const miss = await owner.client.post(`/flows/${flowId}/test`, { message: 'hello' })
    expect(miss.body.data).toMatchObject({ matched: false, steps: [] })
    expect(miss.body.data.reason).toContain('doesn’t match')
    const bad = await owner.client.post(`/flows/${flowId}/test`, {
      contact: { phone: '+91123' },
      message: 'price',
    })
    expect(bad.status).toBe(400)
  })

  it('refuses drafts that are not valid yet', async () => {
    const created = await owner.client.post('/flows', { name: 'Broken' })
    const id = created.body.data.id
    await saveDraft(owner, id, {
      nodes: [{ id: 't', type: 'trigger.keyword', config: { keywords: [] } }],
      edges: [],
      layout: {},
    })
    const res = await owner.client.post(`/flows/${id}/test`, { message: 'x' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('FLOW_INVALID')
  })

  it('reports per-step counts (none before any run) and last-7-day runs', async () => {
    const stats = await owner.client.get(`/flows/${flowId}/node-stats`)
    expect(stats.status).toBe(200)
    expect(stats.body.data).toEqual([])
    const list = await owner.client.get('/flows')
    const mine = list.body.data.find((f: { id: string }) => f.id === flowId)
    expect(mine.executions.last7d).toBe(0)
    expect(mine.trigger).toEqual({
      type: 'trigger.keyword',
      config: { keywords: ['price'], match: 'CONTAINS', caseSensitive: false },
    })
    expect(mine.liveTrigger).toBeNull()
  })
  it('explains matches, non-matches and a window that closes during a simulated wait without sending', async () => {
    const g = graph()
    g.nodes.find((n) => n.id === 'wait')!.config = { amount: 1, unit: 'DAYS' }
    await saveDraft(owner, flowId, g)
    const before = await footprint()
    const r = await owner.client.post(`/flows/${flowId}/test`, {
      contact: { name: 'Asha', tagIds: [vip] },
      message: 'price',
    })
    expect(r.status, r.text).toBe(200)
    expect(r.body.data.explanations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KEYWORD_MATCHED' })]),
    )
    expect(r.body.data.steps.find((s: { nodeId: string }) => s.nodeId === 'send')).toMatchObject({
      status: 'FAILED',
      errorCode: 'CONVERSATION_WINDOW_CLOSED',
      explanations: expect.arrayContaining([expect.objectContaining({ code: 'WINDOW_CLOSED' })]),
    })
    const miss = await owner.client.post(`/flows/${flowId}/test`, { message: 'unrelated' })
    expect(miss.body.data.explanations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KEYWORD_NOT_MATCHED' })]),
    )
    expect(await footprint()).toEqual(before)
    await saveDraft(owner, flowId, graph())
  })
})
