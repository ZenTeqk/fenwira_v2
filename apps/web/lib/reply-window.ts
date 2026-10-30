export type ReplyWindow =
  | { kind: 'checking' }
  | { kind: 'closed' }
  | { kind: 'open'; expiresAt: string; label: string; phase: 'normal' | 'warning' | 'imminent' }

/** Presentation thresholds only. Server verdicts still decide what may be sent. */
export function replyWindow(
  expiresAt: string | null | undefined,
  now: number,
  known: boolean,
): ReplyWindow {
  if (!known || (expiresAt != null && !Number.isFinite(Date.parse(expiresAt))))
    return { kind: 'checking' }
  if (!expiresAt || Date.parse(expiresAt) <= now) return { kind: 'closed' }
  const remaining = Date.parse(expiresAt) - now
  return {
    kind: 'open',
    expiresAt,
    label:
      remaining > 3600_000
        ? `${Math.floor(remaining / 3600_000)}h left`
        : `${Math.ceil(remaining / 60_000)}m left`,
    phase: remaining > 3600_000 ? 'normal' : remaining > 900_000 ? 'warning' : 'imminent',
  }
}

/** One timer wakes at minute intervals and at the exact presentation/expiry boundaries. */
export function replyWindowDelay(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null
  const remaining = Date.parse(expiresAt) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return null
  return Math.min(
    60_000,
    ...[remaining, remaining - 3600_000, remaining - 900_000].filter((delay) => delay > 0),
  )
}
