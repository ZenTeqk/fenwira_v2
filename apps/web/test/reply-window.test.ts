import { describe, expect, it } from 'vitest'
import { replyWindow, replyWindowDelay } from '../lib/reply-window'

const now = Date.parse('2026-10-30T09:00:00Z')
const expiry = (remaining: number) => new Date(now + remaining).toISOString()

describe('reply-window presentation on a controlled clock', () => {
  it.each([
    [23 * 3600_000, 'normal', '23h left'],
    [3600_001, 'normal', '1h left'],
    [3600_000, 'warning', '60m left'],
    [1500_000, 'warning', '25m left'],
    [900_001, 'warning', '16m left'],
    [900_000, 'imminent', '15m left'],
    [480_000, 'imminent', '8m left'],
    [1, 'imminent', '1m left'],
  ])(
    'presents %i ms without changing the server eligibility verdict',
    (remaining, phase, label) => {
      expect(replyWindow(expiry(remaining), now, true)).toMatchObject({
        kind: 'open',
        phase,
        label,
      })
    },
  )
  it('never displays 0m after expiry, including clock jumps and absent windows', () => {
    for (const remaining of [0, -1, -3600_000])
      expect(replyWindow(expiry(remaining), now, true)).toEqual({ kind: 'closed' })
    expect(replyWindow(null, now, true)).toEqual({ kind: 'closed' })
    expect(replyWindow(expiry(60_000), now + 60_000, true)).toEqual({ kind: 'closed' })
  })
  it('does not infer permission from an unknown or malformed expiry', () => {
    expect(replyWindow(expiry(3600_000), now, false)).toEqual({ kind: 'checking' })
    expect(replyWindow('invalid', now, true)).toEqual({ kind: 'checking' })
  })
  it('wakes the single timer at exact thresholds/expiry, never every second', () => {
    expect(replyWindowDelay(expiry(3600_001), now)).toBe(1)
    expect(replyWindowDelay(expiry(900_123), now)).toBe(123)
    expect(replyWindowDelay(expiry(30_000), now)).toBe(30_000)
    expect(replyWindowDelay(expiry(7200_000), now)).toBe(60_000)
    expect(replyWindowDelay(expiry(0), now)).toBeNull()
    expect(replyWindowDelay('invalid', now)).toBeNull()
  })
})
