/**
 * Session idle tracking (docs/SECURITY.md → Sessions). The server owns the idle clock; the browser
 * only tells it when the user actually interacted (X-Fenwira-Active), so background polling never
 * keeps an idle tab signed in.
 */
export const ACTIVITY_HEADER = 'X-Fenwira-Active'
/** Interactions are reported to the server at most this often (each report restarts idle). */
export const REPORT_EVERY_MS = 5 * 60_000
/** The "you'll be signed out" warning shows this long before the idle deadline. */
export const WARN_BEFORE_MS = 5 * 60_000

let lastInteraction = 0
let lastReported = 0

export function noteInteraction(now = Date.now()) {
  lastInteraction = now
}

/** True (and marks it reported) when the user interacted since the last report. */
export function takeActivity(now = Date.now()): boolean {
  if (lastInteraction <= lastReported) return false
  lastReported = now
  return true
}

/** An interaction happened but hasn't been reported for a while: time to tell the server. */
export function reportDue(now = Date.now()): boolean {
  return lastInteraction > lastReported && now - lastReported >= REPORT_EVERY_MS
}

export type SessionDeadlines = { expiresAt: number; idleExpiresAt: number }

/** What the warning should show at `now`. */
export function sessionState(d: SessionDeadlines, now = Date.now()) {
  const end = Math.min(d.expiresAt, d.idleExpiresAt)
  if (end <= now) return { kind: 'expired' as const }
  if (d.idleExpiresAt < d.expiresAt && d.idleExpiresAt - now <= WARN_BEFORE_MS)
    return { kind: 'warning' as const, msLeft: d.idleExpiresAt - now }
  return { kind: 'ok' as const }
}

export const parseDeadlines = (
  s: { expiresAt: string; idleExpiresAt?: string } | null | undefined,
): SessionDeadlines | null =>
  s
    ? {
        expiresAt: Date.parse(s.expiresAt),
        idleExpiresAt: Date.parse(s.idleExpiresAt ?? s.expiresAt),
      }
    : null
