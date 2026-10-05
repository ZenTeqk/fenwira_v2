import { fingerprint } from '../src/modules/platform-operations/operation.core'
import { describe, expect, it } from 'vitest'
import { redactAudit } from '../src/core/security/redact'
import { buildOpenApiDocument } from '../src/openapi/openapi'
describe('platform security contracts', () => {
  it('redacts nested credentials and customer content', () => {
    const value = redactAudit({
      reason: 'Bearer sensitive',
      nested: [{ secret: 's', body: 'customer message', password: 'p', safe: 3 }],
    })
    expect(value).toEqual({
      reason: '[REDACTED]',
      nested: [{ secret: '[REDACTED]', body: '[REDACTED]', password: '[REDACTED]', safe: 3 }],
    })
  })
  it('platform routes never enter the API-key catalog', () => {
    const { document, routes } = buildOpenApiDocument()
    for (const route of routes.filter((r) => r.path.startsWith('/api/v1/platform/')))
      expect(route.publicApi).toBe(false)
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    expect(paths['/api/v1/platform/auth/me']!.get!.security).toEqual([{ platformSession: [] }])
  })
})

it('operation fingerprints preserve money precision and ignore object ordering', () => {
  expect(fingerprint({ b: 2, a: 9007199254740999n })).toBe(
    fingerprint({ a: '9007199254740999', b: 2 }),
  )
  expect(fingerprint({ amount: 5 })).not.toBe(fingerprint({ amount: 6 }))
})
