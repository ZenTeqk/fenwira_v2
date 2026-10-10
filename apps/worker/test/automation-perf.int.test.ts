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
import { chain, createFlow, keyword, text } from './support/automation'
import { metaId, waitFor } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { createOwner } from './support/workspace'

/**
 * Throughput probe (not part of the regular suite: PERF=1). N customers send a keyword; three
 * matching flows each reply, one after another per event (AE3). Reports events/s and steps/s.
 */
const N = Number(process.env.PERF_EVENTS ?? 200)
const SECRET = 'automation-perf-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

beforeAll(async () => {
  if (!process.env.PERF) return
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  if (mock) await new Promise<void>((r) => mock.server.close(() => r()))
})

describe.runIf(process.env.PERF)('automation throughput', { timeout: 600_000 }, () => {
  it(`${N} keyword events × 3 flows`, async () => {
    const owner = await createOwner(api, 'auto-perf')
    const ids = { wabaId: metaId(), phoneNumberId: metaId() }
    await fetch(`${mock.url}/__mock/seed`, {
      method: 'POST',
      body: JSON.stringify({ wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] }),
    })
    await owner.client.post('/whatsapp/connections/dev', {
      ...ids,
      accessToken: `mock-dev:${ids.wabaId}`,
    })
    for (const p of [1, 2, 3])
      await createFlow(
        owner,
        `Perf ${p}`,
        chain(keyword('go'), text('s', `reply ${p} {{contact.firstName}}`)),
        {
          priority: p,
        },
      )
    const started = Date.now()
    for (let i = 0; i < N; i += 20)
      await Promise.all(
        Array.from({ length: Math.min(20, N - i) }, (_, k) =>
          deliverWebhook(
            webhookUrl,
            SECRET,
            inboundMessageWebhook(ids, {
              from: `9199${String(1e7 + i + k)}`,
              wamid: `wamid.${metaId()}`,
              text: 'go',
            }),
          ),
        ),
      )
    const ingested = Date.now()
    const done = await waitFor(
      () =>
        db.withTenant(owner.tenantId, (tx) =>
          tx.automationExecution.count({ where: { status: 'COMPLETED' } }),
        ),
      (n) => n >= N * 3,
      540_000,
    )
    const seconds = (Date.now() - started) / 1000
    const steps = await db.withTenant(owner.tenantId, (tx) => tx.automationExecutionStep.count())
    // eslint-disable-next-line no-console -- the probe's output is its result
    console.log(
      JSON.stringify({
        events: N,
        executions: done,
        steps,
        ingestSeconds: (ingested - started) / 1000,
        totalSeconds: seconds,
        eventsPerSecond: +(N / seconds).toFixed(1),
        executionsPerSecond: +(done / seconds).toFixed(1),
        stepsPerSecond: +(steps / seconds).toFixed(1),
      }),
    )
    expect(done).toBe(N * 3)
  })
})
