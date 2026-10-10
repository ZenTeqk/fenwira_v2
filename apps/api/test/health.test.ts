import { describe, expect, it } from 'vitest'
import { type CoreConfig } from '../src/core/config/core-config'
import { HealthService } from '../src/core/health/health.service'

const config = { service: 'api', version: 'test' } as CoreConfig

describe('HealthService', () => {
  it('reports dependencies up with latency', async () => {
    const health = new HealthService(config, [{ name: 'postgres', check: async () => undefined }])
    const report = await health.readiness()
    expect(report.status).toBe('ok')
    expect(report.checks.postgres?.status).toBe('up')
  })

  it('never exposes driver error text, which can name hosts and ports', async () => {
    const health = new HealthService(config, [
      { name: 'postgres', check: async () => undefined },
      {
        name: 'redis',
        check: async () => {
          throw new Error('connect ECONNREFUSED internal-cache.example:6379')
        },
      },
    ])
    const report = await health.readiness()
    expect(report.status).toBe('error')
    expect(report.checks.redis).toEqual({ status: 'down', error: 'unavailable' })
    expect(JSON.stringify(report)).not.toContain('internal-cache')
  })
})
