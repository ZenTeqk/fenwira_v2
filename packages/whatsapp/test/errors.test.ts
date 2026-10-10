import { describe, expect, it } from 'vitest'
import { classifyMetaError, GraphError } from '../src'

describe('classifyMetaError', () => {
  it.each([
    [131000, 'RETRYABLE', 'META_TRANSIENT'],
    [130429, 'RETRYABLE_RATE', 'META_RATE_LIMITED'],
    [131056, 'RETRYABLE_RATE', 'META_PAIR_RATE_LIMITED'],
    [190, 'CREDENTIAL', 'META_TOKEN_INVALID'],
    [200, 'CREDENTIAL', 'META_PERMISSION_DENIED'],
    [131047, 'PERMANENT', 'CONVERSATION_WINDOW_CLOSED'],
    [132001, 'PERMANENT', 'META_TEMPLATE_ERROR'],
    [100, 'PERMANENT', 'META_INVALID_PARAMETER'],
  ])('code %i → %s', (code, classification, fenwiraCode) => {
    expect(classifyMetaError(code, 400)).toMatchObject({ classification, fenwiraCode })
  })

  it('treats network failures and 5xx without a known code as retryable unavailability', () => {
    expect(classifyMetaError(undefined, undefined).fenwiraCode).toBe('META_UNAVAILABLE')
    expect(classifyMetaError(999999, 503).fenwiraCode).toBe('META_UNAVAILABLE')
  })

  it('retries unknown 4xx codes as META_UNKNOWN_ERROR', () => {
    expect(classifyMetaError(424242, 400)).toMatchObject({
      classification: 'RETRYABLE',
      fenwiraCode: 'META_UNKNOWN_ERROR',
    })
  })
})

describe('GraphError', () => {
  it('exposes classification and retryability', () => {
    expect(new GraphError('x', 429, 4).retryable).toBe(true)
    expect(new GraphError('x', 401, 190).retryable).toBe(false)
    expect(new GraphError('x', 401, 190).classification).toBe('CREDENTIAL')
  })
})
