import { Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { replyPreset } from '@fenwira/contracts'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'
import { saveDraft, publish, type Graph } from './support/automation'
let api: INestApplication, worker: INestApplication, owner: Member, other: Member
beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
  owner = await createOwner(api, 'reply-lifecycle')
  other = await createOwner(api, 'reply-other')
})
afterAll(async () => {
  await worker?.close()
  await api?.close()
})
it('discards only the current draft with If-Match and restores an archive without activating it', async () => {
  const r = await owner.client.post('/flows', { name: 'Lifecycle', managedBy: 'REPLY_STUDIO' })
  const id = r.body.data.id as string
  const graph = replyPreset('keyword')
  await saveDraft(owner, id, graph as Graph)
  expect((await publish(owner, id)).status).toBe(200)
  const published = (await owner.client.get(`/flows/${id}/draft`)).body.data
  const edited = structuredClone(graph)
  edited.nodes.find((n) => n.id === 'reply')!.config.text = 'New response'
  const draft = await saveDraft(owner, id, edited as Graph)
  expect((await other.client.delete(`/flows/${id}/draft`, { 'If-Match': draft.etag })).status).toBe(
    404,
  )
  expect(
    (await owner.client.delete(`/flows/${id}/draft`, { 'If-Match': published.etag })).status,
  ).toBe(409)
  const discarded = await owner.client.delete(`/flows/${id}/draft`, { 'If-Match': draft.etag })
  expect(discarded.status, discarded.text).toBe(200)
  expect(discarded.body.data.id).toBe(published.id)
  expect(discarded.body.data.graph).toEqual(published.graph)
  expect((await owner.client.delete(`/flows/${id}`)).status).toBe(204)
  expect(
    (await owner.client.get('/flows')).body.data.find((f: { id: string }) => f.id === id),
  ).toBeUndefined()
  expect(
    (await owner.client.get('/flows?archived=true')).body.data.find(
      (f: { id: string }) => f.id === id,
    ).status,
  ).toBe('ARCHIVED')
  expect((await other.client.post(`/flows/${id}/restore`, {})).status).toBe(404)
  const restored = await owner.client.post(`/flows/${id}/restore`, {})
  expect(restored.status, restored.text).toBe(200)
  expect(restored.body.data.status).toBe('PAUSED')
  expect((await owner.client.get(`/flows/${id}/draft`)).body.data.id).toBe(published.id)
  await api.get(Database).withTenant(owner.tenantId, async (tx) => {
    const contact = await tx.contact.create({
      data: {
        tenantId: owner.tenantId,
        phoneE164: '+15558889999',
        name: 'Failure sample',
        source: 'MANUAL',
      },
    })
    const execution = await tx.automationExecution.create({
      data: {
        tenantId: owner.tenantId,
        flowId: id,
        flowVersionId: published.id,
        contactId: contact.id,
        triggerEvent: {},
        context: {},
        status: 'FAILED',
        currentNodeId: 'reply',
        errorCode: 'CONTACT_BLOCKED',
        errorDetail: 'This contact is blocked.',
      },
    })
    await tx.automationExecutionStep.create({
      data: {
        tenantId: owner.tenantId,
        executionId: execution.id,
        seq: 1,
        nodeId: 'reply',
        nodeType: 'action.send_message',
        status: 'FAILED',
        input: {},
        output: {},
        errorCode: 'CONTACT_BLOCKED',
        errorDetail: 'This contact is blocked.',
      },
    })
  })
  const report = await owner.client.get(
    `/reply-studio/reports?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`,
  )
  expect(report.status, report.text).toBe(200)
  expect(report.body.data.flows.find((f: { flowId: string }) => f.flowId === id)).toMatchObject({
    kind: 'AUTO_REPLY',
    sent: 0,
    blocked: 0,
    sendFailed: 0,
    failures: 1,
  })
  expect(report.body.data.failures[0]).toMatchObject({
    flowId: id,
    step: 'reply',
    code: 'CONTACT_BLOCKED',
  })
})
