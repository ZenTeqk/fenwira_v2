import { type ContactActivity, type Message } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import { activityWatermark, countryLabel, customerActivity } from '../lib/customer-panel'

const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString()
const audit = (
  id: string,
  type: string,
  day: number,
  data: Record<string, unknown> = {},
): ContactActivity => ({
  id,
  type,
  occurredAt: at(day),
  data,
  actorType: 'USER',
  actorId: 'agent',
  actorName: 'Priya',
})
const system = (
  id: string,
  event: string,
  day: number,
  data: Record<string, unknown> = {},
): Message => ({
  id,
  conversationId: 'conversation',
  contactId: 'contact',
  type: 'SYSTEM_EVENT',
  direction: 'SYSTEM',
  source: 'SYSTEM',
  status: 'RECEIVED',
  content: { type: 'SYSTEM_EVENT', event, data },
  createdAt: at(day),
  aiGenerated: false,
  providerMessageId: null,
  errorCode: null,
  errorDetail: null,
  sentByUserId: null,
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  providerTimestamp: null,
  templateSnapshot: null,
})

describe('customer panel recorded activity', () => {
  it('merges actual contact-note/tag records and conversation system events in newest-first order', () => {
    const events = customerActivity(
      [audit('note', 'note.added', 29), audit('tag', 'tag.added', 27, { tag: 'Follow-up' })],
      [
        system('assignment', 'assigned', 30, { toName: 'Arun', actorName: 'Priya' }),
        system('resume', 'automation_resumed', 28, { reason: 'auto_release' }),
      ],
    )
    expect(events.map((event) => event.text)).toEqual([
      'Assigned to Arun',
      'Contact note added',
      'Automation resumed automatically',
      'Added tag “Follow-up”',
    ])
    expect(events[0]?.actor).toBe('Priya')
  })
  it('does not turn customer text, lifecycle changes or unknown events into invented activity', () => {
    const inbound = {
      ...system('inbound', 'takeover', 30),
      direction: 'INBOUND' as const,
      type: 'TEXT' as const,
      content: { type: 'TEXT' as const, text: 'Hello' },
    }
    expect(
      customerActivity(
        [audit('created', 'contact.created', 30)],
        [inbound, system('status', 'status_changed', 29), system('unknown', 'future_event', 28)],
      ),
    ).toEqual([])
  })
  it('keeps contact notes distinct, deduplicates overlapping pages and does not invent missing names', () => {
    const event = audit('same-id', 'note.added', 28)
    const message = system('same-id', 'assigned', 29)
    expect(customerActivity([event, event], [message, message])).toMatchObject([
      { text: 'Assigned to an agent', actor: undefined },
      { text: 'Contact note added' },
    ])
    expect(customerActivity([audit('tag', 'tag.removed', 30, { tag: 7 })], [])[0]?.text).toBe(
      'Removed tag',
    )
  })
  it('does not display older records before the matching interval in the other source is loaded', () => {
    const cutoff = activityWatermark([at(29), at(20)], false, [at(30), at(27)], true)
    expect(cutoff).toBe(at(27))
    expect(
      customerActivity(
        [audit('older-note', 'note.added', 20)],
        [system('assignment', 'assigned', 30)],
        cutoff,
      ).map((event) => event.id),
    ).toEqual(['message-assignment'])
    expect(activityWatermark([at(29), at(20)], false, [at(30), at(10)], false)).toBeUndefined()
  })
  it('respects the less-complete contact cursor and advances coverage when either source pages', () => {
    expect(activityWatermark([at(30), at(29)], true, [at(30), at(20)], true)).toBe(at(29))
    expect(activityWatermark([at(30), at(10)], true, [at(30), at(20)], true)).toBe(at(20))
    expect(activityWatermark([], false, [], false)).toBeUndefined()
  })
})

describe('stored country labels', () => {
  it('shows readable names for valid stored codes and preserves an unrecognised value', () => {
    expect(countryLabel('IN')).toBe('India')
    expect(countryLabel('gb')).toBe('United Kingdom')
    expect(countryLabel('not-a-code')).toBe('not-a-code')
  })
})
