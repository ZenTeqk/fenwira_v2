import { apiKeyScopeSchema, roleSchema, walletOperationSchema } from '@fenwira/contracts'
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

it('platform authority cannot be serialized as a tenant role or API-key scope', () => {
  expect(roleSchema.safeParse('PLATFORM_OPERATOR').success).toBe(false)
  for (const scope of ['wallet.manage', 'financial.read', 'subscription.manage', 'platform'])
    expect(apiKeyScopeSchema.safeParse(scope).success).toBe(false)
  expect(
    walletOperationSchema.safeParse({
      kind: 'paid_credit',
      amountMinor: 1,
      currency: 'INR',
      reason: 'Bearer secret-material',
      reference: 'support',
      idempotencyKey: 'safe-test-key',
    }).success,
  ).toBe(false)
  const { document } = buildOpenApiDocument()
  for (const [path, methods] of Object.entries(
    document.paths as Record<string, Record<string, Record<string, unknown>>>,
  )) {
    if (
      !path.startsWith('/api/v1/platform/') ||
      ['/api/v1/platform/auth/login', '/api/v1/platform/auth/verify'].includes(path)
    )
      continue
    for (const operation of Object.values(methods))
      expect(operation.security).toEqual([{ platformSession: [] }])
  }
})
