import { describe, expect, it } from 'vitest'
import { apiEnvSchema, EnvValidationError, loadEnv, workerEnvSchema } from '../src/env'

const valid = {
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@db:5432/fenwira',
  REDIS_URL: 'redis://redis:6379/0',
  ENCRYPTION_KEYS: 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 'b',
}

describe('loadEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = loadEnv(apiEnvSchema, { ...valid, PORT: '4001', SYSTEM_PING_ENABLED: 'true' })
    expect(env.PORT).toBe(4001)
    expect(env.SYSTEM_PING_ENABLED).toBe(true)
    expect(env.NODE_ENV).toBe('development')
    expect(env.DB_POOL_SIZE).toBe(10)
  })

  it('defaults SYSTEM_PING_ENABLED to false', () => {
    expect(loadEnv(apiEnvSchema, valid).SYSTEM_PING_ENABLED).toBe(false)
  })

  it('reports every invalid or missing variable at once', () => {
    try {
      loadEnv(apiEnvSchema, { DATABASE_URL: 'mysql://nope' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError)
      const msg = (err as Error).message
      expect(msg).toContain('WEB_ORIGIN')
      expect(msg).toContain('DATABASE_URL')
      expect(msg).toContain('REDIS_URL')
    }
  })
  it('refuses unsafe production settings', () => {
    try {
      loadEnv(apiEnvSchema, {
        ...valid,
        NODE_ENV: 'production',
        SYSTEM_PING_ENABLED: 'true',
        WHATSAPP_DEV_CONNECT: 'true',
      })
      expect.unreachable()
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('JWT_PRIVATE_KEY: is required in production')
      expect(msg).toContain('COOKIE_SECURE: must be true in production')
      expect(msg).toContain('SYSTEM_PING_ENABLED: must be false in production')
      expect(msg).toContain('WHATSAPP_DEV_CONNECT: must be false in production')
    }
  })

  it('defaults Meta config and validates the Graph version', () => {
    const env = loadEnv(apiEnvSchema, { ...valid, META_APP_ID: '  ' })
    expect(env.META_APP_ID).toBeUndefined()
    expect(env.META_GRAPH_API_VERSION).toBe('v23.0')
    expect(env.WHATSAPP_DEV_CONNECT).toBe(false)
    expect(() => loadEnv(apiEnvSchema, { ...valid, META_GRAPH_API_VERSION: '23' })).toThrow(
      /META_GRAPH_API_VERSION/,
    )
  })

  it('allows automation webhook dev hosts only outside production (P10-D4)', () => {
    const worker = { ...valid, SMTP_URL: 'smtp://mail:1025', MAIL_FROM: 'a@b.c' }
    const dev = loadEnv(workerEnvSchema, {
      ...worker,
      AUTOMATION_WEBHOOK_DEV_HOSTS: ' Receiver , meta-mock ',
    })
    expect(dev.AUTOMATION_WEBHOOK_DEV_HOSTS).toEqual(['receiver', 'meta-mock'])
    expect(loadEnv(workerEnvSchema, worker).AUTOMATION_WEBHOOK_DEV_HOSTS).toEqual([])
    expect(() =>
      loadEnv(workerEnvSchema, {
        ...worker,
        NODE_ENV: 'production',
        AUTOMATION_WEBHOOK_DEV_HOSTS: 'receiver',
      }),
    ).toThrow(/AUTOMATION_WEBHOOK_DEV_HOSTS: must be empty in production/)
  })

  it('binds every listener to 0.0.0.0 unless a host is configured (D1)', () => {
    const worker = { ...valid, SMTP_URL: 'smtp://mail:1025', MAIL_FROM: 'a@b.c' }
    const api = loadEnv(apiEnvSchema, valid)
    expect(api.HOST).toBe('0.0.0.0')
    expect(api.METRICS_HOST).toBe('0.0.0.0')
    expect(loadEnv(workerEnvSchema, worker).WORKER_HEALTH_HOST).toBe('0.0.0.0')

    const native = loadEnv(apiEnvSchema, { ...valid, HOST: '127.0.0.1', METRICS_HOST: '127.0.0.1' })
    expect(native.HOST).toBe('127.0.0.1')
    expect(native.METRICS_HOST).toBe('127.0.0.1')
    expect(
      loadEnv(workerEnvSchema, { ...worker, WORKER_HEALTH_HOST: '127.0.0.1' }).WORKER_HEALTH_HOST,
    ).toBe('127.0.0.1')
  })

  it('accepts S3 static credentials as a pair or not at all (D1)', () => {
    const worker = { ...valid, SMTP_URL: 'smtp://mail:1025', MAIL_FROM: 'a@b.c' }
    const roleBased = { ...valid, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: '' }
    const api = loadEnv(apiEnvSchema, roleBased)
    expect(api.S3_ACCESS_KEY_ID).toBeUndefined()
    expect(api.S3_SECRET_ACCESS_KEY).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...worker, ...roleBased }).S3_ACCESS_KEY_ID).toBeUndefined()

    expect(() => loadEnv(apiEnvSchema, { ...valid, S3_SECRET_ACCESS_KEY: undefined })).toThrow(
      /S3_SECRET_ACCESS_KEY: set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither/,
    )
    expect(() => loadEnv(workerEnvSchema, { ...worker, S3_ACCESS_KEY_ID: undefined })).toThrow(
      /S3_ACCESS_KEY_ID: set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither/,
    )
  })
})
