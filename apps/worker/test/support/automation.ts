import { type Database } from '@fenwira/database'
import { expect } from 'vitest'
import { metaId, waitFor } from './campaigns'
import { type Member } from './workspace'

/** Graph builders and API helpers for the Phase 10 suites (docs/prompts/PHASE_10_AUTOMATION.md). */

export type Node = { id: string; type: string; config: Record<string, unknown> }
export type Edge = { id: string; source: string; target: string; sourceHandle: string }
export type Graph = { nodes: Node[]; edges: Edge[]; layout: Record<string, never> }

export const keyword = (...keywords: string[]): Node => ({
  id: 'trigger',
  type: 'trigger.keyword',
  config: { keywords, match: 'EXACT', caseSensitive: false },
})
export const text = (id: string, body: string): Node => ({
  id,
  type: 'action.send_message',
  config: { text: body },
})
export const delay = (id: string, amount = 1): Node => ({
  id,
  type: 'action.delay',
  config: { amount, unit: 'MINUTES' },
})
export const end = (id = 'end'): Node => ({ id, type: 'action.end', config: {} })

/** trigger → a → b → … → end, all through `next`. */
export function chain(trigger: Node, ...steps: Node[]): Graph {
  const nodes = [trigger, ...steps, end()]
  const edges = nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    source: nodes[i]!.id,
    target: n.id,
    sourceHandle: 'next',
  }))
  return { nodes, edges, layout: {} }
}

type FlowOpts = { priority?: number; reentryPolicy?: string; publish?: boolean }

/** Create → save draft (If-Match) → publish (Idempotency-Key). Returns the flow id. */
export async function createFlow(
  m: Member,
  name: string,
  graph: Graph,
  opts: FlowOpts = {},
): Promise<string> {
  const created = await m.client.post('/flows', {
    name,
    priority: opts.priority ?? 100,
    reentryPolicy: opts.reentryPolicy ?? 'ALWAYS',
  })
  expect(created.status, created.text).toBe(201)
  const id = created.body.data.id as string
  await saveDraft(m, id, graph)
  if (opts.publish !== false) {
    const pub = await publish(m, id)
    expect(pub.status, pub.text).toBe(200)
  }
  return id
}

export async function saveDraft(m: Member, id: string, graph: Graph) {
  const draft = await m.client.get(`/flows/${id}/draft`)
  const res = await m.client.put(
    `/flows/${id}/draft`,
    { graph },
    { 'If-Match': draft.body.data.etag },
  )
  expect(res.status, res.text).toBe(200)
  return res.body.data
}

export const publish = (m: Member, id: string) =>
  m.client.post(`/flows/${id}/publish`, {}, { 'Idempotency-Key': `pub-${metaId()}` })

export type Exec = {
  id: string
  status: string
  flowVersionId: string
  triggerRunId: string | null
  errorCode: string | null
  startedAt: string
  finishedAt: string | null
  steps?: Array<{
    seq: number
    nodeId: string
    status: string
    errorCode: string | null
    input: unknown
    output: unknown
  }>
}

export const executions = async (m: Member, flowId: string): Promise<Exec[]> =>
  (await m.client.get(`/flows/${flowId}/executions`)).body.data

export const execution = async (m: Member, id: string): Promise<Exec> =>
  (await m.client.get(`/executions/${id}`)).body.data

/** Waits until the flow has `count` executions and every one satisfies `done`. */
export function executionsWhere(
  m: Member,
  flowId: string,
  done: (e: Exec) => boolean,
  count = 1,
  timeoutMs = 30_000,
) {
  return waitFor(
    () => executions(m, flowId),
    (list) => list.length >= count && list.every(done),
    timeoutMs,
  )
}

export const terminal = (e: Exec) =>
  ['COMPLETED', 'FAILED', 'CANCELLED', 'STOPPED_TAKEOVER'].includes(e.status)

/** Automation messages sent in a tenant (MessagingService rows with source AUTOMATION). */
export function automationMessages(db: Database, tenantId: string) {
  return db.withTenant(tenantId, (tx) =>
    tx.message.findMany({
      where: { source: 'AUTOMATION' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, idempotencyKey: true, contactId: true, createdAt: true },
    }),
  )
}

export const textOf = (m: { content: unknown }) => (m.content as { text?: string }).text ?? ''

/** Moves a WAITING execution's wait_until into the past (fast-forwards a delay). */
export const dueNow = (db: Database, tenantId: string, executionId: string) =>
  db.withTenant(tenantId, (tx) =>
    tx.automationExecution.update({
      where: { id: executionId },
      data: { waitUntil: new Date(Date.now() - 1000) },
    }),
  )
