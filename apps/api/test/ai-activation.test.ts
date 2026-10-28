import { createAiActivationRequestSchema } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import { AppError } from '../src/core/http/app-error'
import { assertCanRequest } from '../src/modules/ai/ai-activation.core'

const PLAN = '0193a000-0000-7000-8000-000000000001'
const valid = {
  planId: PLAN,
  expectedConversations: 500,
  useCase: 'Answer product questions on WhatsApp',
  contactEmail: 'owner@example.test',
  contactPhone: '+91 98765 43210',
}

const code = (fn: () => void) => {
  try {
    fn()
  } catch (err) {
    return err instanceof AppError ? err.code : 'other'
  }
  return 'ok'
}

describe('AI activation request validation', () => {
  it('accepts a complete request and a request without a phone', () => {
    expect(createAiActivationRequestSchema.safeParse(valid).success).toBe(true)
    expect(
      createAiActivationRequestSchema.safeParse({ ...valid, contactPhone: null }).success,
    ).toBe(true)
  })

  it.each([
    ['expectedConversations', 0],
    ['expectedConversations', 1.5],
    ['expectedConversations', 10_000_001],
    ['useCase', 'too short'],
    ['useCase', 'x'.repeat(1001)],
    ['contactEmail', 'not-an-email'],
    ['contactPhone', 'call me'],
    ['planId', 'basic'],
  ])('rejects %s = %j', (field, value) => {
    const parsed = createAiActivationRequestSchema.safeParse({ ...valid, [field]: value })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual([field])
  })

  it('trims the use case before checking its length', () => {
    const parsed = createAiActivationRequestSchema.safeParse({ ...valid, useCase: '   short   ' })
    expect(parsed.success).toBe(false)
  })
})

describe('AI activation request rules', () => {
  const open = { enabled: false, openRequest: false, activePlanIds: [PLAN] }

  it('allows a request for an active plan', () => {
    expect(code(() => assertCanRequest({ planId: PLAN }, open))).toBe('ok')
  })

  it('prevents a duplicate while a request is open', () => {
    expect(code(() => assertCanRequest({ planId: PLAN }, { ...open, openRequest: true }))).toBe(
      'AI_REQUEST_OPEN',
    )
  })

  it('refuses when the assistant is already on', () => {
    expect(code(() => assertCanRequest({ planId: PLAN }, { ...open, enabled: true }))).toBe(
      'AI_ALREADY_ENABLED',
    )
  })

  it('requires an active plan when plans exist, and none when they do not', () => {
    expect(
      code(() => assertCanRequest({ planId: '0193a000-0000-7000-8000-000000000002' }, open)),
    ).toBe('AI_PLAN_UNAVAILABLE')
    expect(code(() => assertCanRequest({ planId: null }, open))).toBe('AI_PLAN_UNAVAILABLE')
    expect(code(() => assertCanRequest({ planId: null }, { ...open, activePlanIds: [] }))).toBe(
      'ok',
    )
    expect(code(() => assertCanRequest({ planId: PLAN }, { ...open, activePlanIds: [] }))).toBe(
      'AI_PLAN_UNAVAILABLE',
    )
  })
})
