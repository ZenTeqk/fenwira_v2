import { describe, expect, it } from 'vitest'
import { apiEnvSchema, EnvValidationError, loadEnv } from '../src/env'

const valid = {
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@db:5432/fenwira',
  REDIS_URL: 'redis://redis:6379/0',
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
})
