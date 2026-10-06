import { describe, expect, it } from 'vitest'
import { followsSameSender } from '../lib/message-grouping'

const reply = {
  direction: 'OUTBOUND',
  sentByUserId: 'agent-a',
  source: 'INBOX',
  createdAt: '2026-10-06T10:00:00Z',
} as const
describe('message grouping', () => {
  it('groups consecutive replies within five minutes, but keeps different senders and sources separate', () => {
    const next = { ...reply, createdAt: '2026-10-06T10:02:00Z' }
    expect(followsSameSender(next, reply)).toBe(true)
    expect(followsSameSender({ ...next, sentByUserId: 'agent-b' }, reply)).toBe(false)
    expect(followsSameSender({ ...next, source: 'AUTOMATION' }, reply)).toBe(false)
    expect(followsSameSender({ ...next, direction: 'INBOUND' }, reply)).toBe(false)
  })
  it('separates dates, long gaps, out-of-order timestamps and system events', () => {
    expect(followsSameSender(reply)).toBe(false)
    expect(followsSameSender({ ...reply, createdAt: '2026-10-06T10:06:00Z' }, reply)).toBe(false)
    expect(followsSameSender({ ...reply, createdAt: '2026-10-06T09:59:00Z' }, reply)).toBe(false)
    expect(followsSameSender({ ...reply, direction: 'SYSTEM' }, reply)).toBe(false)
    expect(followsSameSender({ ...reply, createdAt: '2026-10-07T10:00:00Z' }, reply)).toBe(false)
  })
})
