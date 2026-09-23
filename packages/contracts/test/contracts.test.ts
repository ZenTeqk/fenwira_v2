import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  errorEnvelopeSchema,
  EVENT_PAYLOAD_SCHEMAS,
  healthResponseSchema,
  isDomainEventType,
} from '../src'

describe('error catalog', () => {
  it('has unique UPPER_SNAKE codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/)
  })

  it('accepts a well-formed envelope and rejects unknown codes', () => {
    const ok = errorEnvelopeSchema.safeParse({
      error: { code: 'VALIDATION_FAILED', message: 'bad', correlationId: 'c1', fieldErrors: [] },
    })
    expect(ok.success).toBe(true)
    const bad = errorEnvelopeSchema.safeParse({
      error: { code: 'MADE_UP', message: 'x', correlationId: 'c1' },
    })
    expect(bad.success).toBe(false)
  })
})

describe('events', () => {
  it('uses dotted lowercase event names', () => {
    for (const type of Object.keys(EVENT_PAYLOAD_SCHEMAS))
      expect(type).toMatch(/^[a-z_]+(\.[a-z_]+)+$/)
  })

  it('narrows known event types', () => {
    expect(isDomainEventType('system.ping.requested')).toBe(true)
    expect(isDomainEventType('nope.nope')).toBe(false)
    expect(isDomainEventType('toString')).toBe(false)
  })
})

describe('health', () => {
  it('validates a readiness payload', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      version: 'dev',
      checks: { postgres: { status: 'up', latencyMs: 2 } },
    })
    expect(parsed.checks.postgres?.status).toBe('up')
  })
})
