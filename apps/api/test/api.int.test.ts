import { apiEnvSchema, loadEnv } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from '../src/bootstrap'

// Real Postgres + Redis from .env.test (runs in the fenwira-test compose service or CI).
let app: INestApplication

beforeAll(async () => {
  const env = loadEnv(apiEnvSchema, {
    ...process.env,
    SYSTEM_PING_ENABLED: 'true',
    LOG_LEVEL: 'silent',
  })
  app = await createApiApp(env)
  await app.init()
})

afterAll(async () => {
  await app?.close()
})

describe('health endpoints (outside /api/v1)', () => {
  it('reports live', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('becomes ready once postgres, redis and the queue connection are up', async () => {
    // Connections are established asynchronously after boot; readiness is 503 until then
    // (exactly what the Docker healthcheck retries on), then 200.
    let res = await request(app.getHttpServer()).get('/health/ready')
    for (let i = 0; i < 50 && res.status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 100))
      res = await request(app.getHttpServer()).get('/health/ready')
    }
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'api',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' }, queue: { status: 'up' } },
    })
  })

  it('is not served under the api prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(404)
  })
})

describe('HTTP conventions', () => {
  it('echoes a supplied correlation id and generates one otherwise', async () => {
    const supplied = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Correlation-Id', 'test-corr-123')
    expect(supplied.headers['x-correlation-id']).toBe('test-corr-123')
    const generated = await request(app.getHttpServer()).get('/health/live')
    expect(generated.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('X-Correlation-Id', 'corr-404')
      .expect(404)
    // The envelope gained hint and requestId (= correlationId) with the error-envelope change.
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        hint: expect.any(String),
        correlationId: 'corr-404',
        requestId: 'corr-404',
      },
    })
  })

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('allows credentialed CORS from the web origin only', async () => {
    const origin = process.env.WEB_ORIGIN!
    const ok = await request(app.getHttpServer())
      .options('/api/v1/system/ping')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
    expect(ok.headers['access-control-allow-origin']).toBe(origin)
    expect(ok.headers['access-control-allow-credentials']).toBe('true')
    const evil = await request(app.getHttpServer())
      .options('/api/v1/system/ping')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example')
  })
})

describe('system ping (api side)', () => {
  it('accepts a ping, returns the event id, and reports it pending until a worker processes it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/system/ping')
      .set('X-Correlation-Id', 'ping-corr')
      .expect(202)
    expect(res.body).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      correlationId: 'ping-corr',
    })
    const status = await request(app.getHttpServer())
      .get(`/api/v1/system/ping/${res.body.eventId}`)
      .expect(200)
    expect(status.body.eventId).toBe(res.body.eventId)
    expect(['PENDING', 'PROCESSED']).toContain(status.body.status)
  })

  it('validates the event id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/ping/not-a-uuid').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('system ping disabled', () => {
  it('is not routable when SYSTEM_PING_ENABLED=false', async () => {
    const env = loadEnv(apiEnvSchema, {
      ...process.env,
      SYSTEM_PING_ENABLED: 'false',
      LOG_LEVEL: 'silent',
    })
    const disabled = await createApiApp(env)
    await disabled.init()
    try {
      await request(disabled.getHttpServer()).post('/api/v1/system/ping').expect(404)
    } finally {
      await disabled.close()
    }
  })
})
