import { createApiApp } from '@fenwira/api/bootstrap'
import { apiEnvSchema, loadEnv, workerEnvSchema } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorkerApp } from '../src/bootstrap'

// Full path from ADR-0013: HTTP → outbox row → relay (LISTEN/poll) → BullMQ → processor.
let api: INestApplication
let worker: INestApplication

beforeAll(async () => {
  api = await createApiApp(
    loadEnv(apiEnvSchema, { ...process.env, SYSTEM_PING_ENABLED: 'true', LOG_LEVEL: 'silent' }),
  )
  await api.init()
  worker = await createWorkerApp(loadEnv(workerEnvSchema, { ...process.env, LOG_LEVEL: 'silent' }))
  await worker.init()
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`condition not met within ${timeoutMs}ms`)
}

describe('outbox round trip', () => {
  it('processes a ping end to end, carrying the correlation id', async () => {
    const accepted = await request(api.getHttpServer())
      .post('/api/v1/system/ping')
      .set('X-Correlation-Id', 'roundtrip-corr')
      .expect(202)

    const processed = await waitFor(async () => {
      const res = await request(api.getHttpServer()).get(
        `/api/v1/system/ping/${accepted.body.eventId}`,
      )
      return res.body.status === 'PROCESSED' ? res.body : undefined
    })
    expect(processed).toMatchObject({ status: 'PROCESSED', correlationId: 'roundtrip-corr' })
  })

  it('processes every ping in a concurrent burst', async () => {
    const ids = await Promise.all(
      Array.from(
        { length: 25 },
        async () =>
          (await request(api.getHttpServer()).post('/api/v1/system/ping').expect(202)).body
            .eventId as string,
      ),
    )
    await waitFor(async () => {
      const statuses = await Promise.all(
        ids.map(
          async (id) =>
            (await request(api.getHttpServer()).get(`/api/v1/system/ping/${id}`)).body.status,
        ),
      )
      return statuses.every((s) => s === 'PROCESSED') ? true : undefined
    }, 15_000)
  })

  it('reports worker readiness including processors and relay heartbeat', async () => {
    const res = await request(worker.getHttpServer()).get('/health/ready').expect(200)
    expect(res.body).toMatchObject({
      service: 'worker',
      checks: {
        postgres: { status: 'up' },
        redis: { status: 'up' },
        processors: { status: 'up' },
        'outbox-relay': { status: 'up' },
      },
    })
  })
})
