import { describe, expect, it } from 'vitest'
import { toHealthView } from '../lib/health'

describe('toHealthView', () => {
  it('maps a healthy API report', () => {
    const view = toHealthView({
      status: 'ok',
      service: 'api',
      version: 'abc123',
      checks: {
        postgres: { status: 'up', latencyMs: 3 },
        redis: { status: 'down', error: 'ECONNREFUSED' },
      },
    })
    expect(view).toEqual({
      reachable: true,
      overall: 'ok',
      version: 'abc123',
      checks: [
        { name: 'postgres', up: true, detail: '3 ms' },
        { name: 'redis', up: false, detail: 'ECONNREFUSED' },
      ],
    })
  })

  it('treats malformed payloads as unreachable instead of crashing', () => {
    expect(toHealthView({ nope: true })).toEqual({
      reachable: false,
      reason: 'Unexpected response from the API.',
    })
    expect(toHealthView(null).reachable).toBe(false)
  })
})
