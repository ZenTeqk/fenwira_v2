import { EVENT_PAYLOAD_SCHEMAS } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  ALL_QUEUE_NAMES,
  EVENT_SUBSCRIPTIONS,
  eventJobId,
  isQueueName,
  jobId,
  subscribersFor,
} from '../src'

describe('queue catalog', () => {
  it('has unique dotted names without the BullMQ key separator', () => {
    expect(new Set(ALL_QUEUE_NAMES).size).toBe(ALL_QUEUE_NAMES.length)
    for (const name of ALL_QUEUE_NAMES) {
      expect(name).toMatch(/^[a-z]+(\.[a-z]+)+$/)
      expect(name).not.toContain(':')
    }
  })
})

describe('event subscriptions', () => {
  it('covers every domain event type and only targets known queues', () => {
    expect(Object.keys(EVENT_SUBSCRIPTIONS).sort()).toEqual(
      Object.keys(EVENT_PAYLOAD_SCHEMAS).sort(),
    )
    for (const queues of Object.values(EVENT_SUBSCRIPTIONS)) {
      for (const q of queues) expect(isQueueName(q)).toBe(true)
    }
  })

  it('returns no subscribers for unknown or prototype keys', () => {
    expect(subscribersFor('unknown.event')).toEqual([])
    expect(subscribersFor('constructor')).toEqual([])
    expect(subscribersFor('system.ping.requested')).toEqual(['system.ping'])
  })
})

describe('jobId', () => {
  it('joins parts deterministically', () => {
    expect(jobId('campaign', 'abc', 3)).toBe('campaign__abc__3')
    expect(eventJobId('0192', 'system.ping')).toBe('0192__system.ping')
  })

  it('rejects the BullMQ separator and empty parts', () => {
    expect(() => jobId('a:b')).toThrow(/must not contain ':'/)
    expect(() => jobId('')).toThrow(/non-empty/)
  })
})
