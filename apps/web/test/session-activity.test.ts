import { describe, expect, it } from 'vitest'
import {
  noteInteraction,
  parseDeadlines,
  REPORT_EVERY_MS,
  reportDue,
  sessionState,
  takeActivity,
} from '../lib/session-activity'

const T = Date.parse('2026-10-23T08:00:00Z')
const M = 60_000

describe('session activity', () => {
  it('declares activity only after a real interaction, once per report', () => {
    expect(takeActivity(T)).toBe(false)
    noteInteraction(T + 1)
    expect(takeActivity(T + 2)).toBe(true)
    expect(takeActivity(T + 3)).toBe(false)
  })

  it('asks to report an interaction at most every 5 minutes', () => {
    noteInteraction(T + 10)
    takeActivity(T + 10)
    noteInteraction(T + 2 * M)
    expect(reportDue(T + 2 * M)).toBe(false)
    expect(reportDue(T + 10 + REPORT_EVERY_MS)).toBe(true)
  })

  it('warns 5 minutes before the idle deadline and expires at either deadline', () => {
    const d = { expiresAt: T + 12 * 60 * M, idleExpiresAt: T + 3 * 60 * M }
    expect(sessionState(d, T).kind).toBe('ok')
    expect(sessionState(d, d.idleExpiresAt - 6 * M).kind).toBe('ok')
    expect(sessionState(d, d.idleExpiresAt - 4 * M)).toEqual({ kind: 'warning', msLeft: 4 * M })
    expect(sessionState(d, d.idleExpiresAt).kind).toBe('expired')
    // When the absolute limit comes first there is nothing to extend: no idle warning.
    const abs = { expiresAt: T + 60 * M, idleExpiresAt: T + 60 * M }
    expect(sessionState(abs, T + 58 * M).kind).toBe('ok')
    expect(sessionState(abs, T + 60 * M).kind).toBe('expired')
  })

  it('parses server deadlines (platform falls back to the absolute end)', () => {
    expect(parseDeadlines({ expiresAt: '2026-10-23T20:00:00Z' })).toEqual({
      expiresAt: T + 12 * 60 * M,
      idleExpiresAt: T + 12 * 60 * M,
    })
    expect(parseDeadlines(null)).toBeNull()
  })
})
