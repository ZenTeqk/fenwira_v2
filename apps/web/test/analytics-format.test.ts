import { describe, expect, it } from 'vitest'
import { activeDays, countDelta, latestStatusSeries } from '../lib/analytics-format'

describe('latestStatusSeries', () => {
  it('turns nested status classes into mutually exclusive latest statuses', () => {
    const p = latestStatusSeries([
      { day: '2026-11-01', values: { sent: 100, delivered: 90, read: 60, failed: 5 } },
    ])?.[0]
    expect(p).toBeDefined()
    expect(p!.values).toEqual({ read: 60, deliveredOnly: 30, sentOnly: 10, failed: 5 })
    // The stack's total (messages represented, pending excluded): sent (⊇ delivered ⊇ read) + failed.
    expect(Object.values(p!.values).reduce((a, b) => a + b, 0)).toBe(105)
  })

  it('keeps zero-activity days', () => {
    const out = latestStatusSeries([
      { day: '2026-11-01', values: {} },
      { day: '2026-11-02', values: { sent: 1, delivered: 1, read: 0, failed: 0 } },
    ])
    expect(out?.map((p) => p.day)).toEqual(['2026-11-01', '2026-11-02'])
    expect(out?.[0]!.values).toEqual({ read: 0, deliveredOnly: 0, sentOnly: 0, failed: 0 })
  })

  it('refuses to subtract counts that break read ≤ delivered ≤ sent (no silent clamping)', () => {
    const ok = { day: '2026-11-01', values: { sent: 2, delivered: 1, read: 1, failed: 0 } }
    expect(
      latestStatusSeries([ok, { day: '2026-11-02', values: { sent: 3, delivered: 4, read: 0 } }]),
    ).toBeNull()
    expect(
      latestStatusSeries([ok, { day: '2026-11-02', values: { sent: 3, delivered: 2, read: 3 } }]),
    ).toBeNull()
    expect(latestStatusSeries([{ day: '2026-11-02', values: { sent: 1, failed: -1 } }])).toBeNull()
  })
})

describe('activeDays', () => {
  it('counts days with any activity out of every day in the range', () => {
    expect(
      activeDays([
        { day: '2026-11-01', values: { sent: 0, failed: 0 } },
        { day: '2026-11-02', values: { sent: 0, failed: 1 } },
        { day: '2026-11-03', values: { sent: 2 } },
      ]),
    ).toEqual({ active: 2, total: 3 })
  })
})

describe('countDelta', () => {
  it('is neutral for volumes whose direction is neither good nor bad', () => {
    expect(countDelta({ value: 120, previous: 100 }, 'neutral')).toMatchObject({
      value: '+20%',
      direction: 'up',
      sentiment: 'neutral',
    })
    expect(countDelta({ value: 80, previous: 100 }, 'neutral')?.sentiment).toBe('neutral')
    expect(countDelta({ value: 80, previous: 100 }, false)?.sentiment).toBe('positive')
  })

  it('gives an absolute change when the previous period was 0, never Infinity', () => {
    const d = countDelta({ value: 1500, previous: 0 }, 'neutral', (n) => `₹${n / 100}`)
    expect(d).toMatchObject({ value: '+₹15', label: 'vs none in the previous period' })
    expect(countDelta({ value: 0, previous: 0 })?.value).toBe('No change')
    expect(countDelta({ value: 5, previous: null })).toBeUndefined()
  })
})
