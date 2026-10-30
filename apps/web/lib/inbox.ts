'use client'

import { type Conversation } from '@fenwira/contracts'
import { useEffect, useState } from 'react'

export const displayName = (c: Pick<Conversation, 'contact'>) =>
  c.contact.name ?? c.contact.waProfileName ?? c.contact.phoneE164

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** Ticks every `ms` so countdowns re-render. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** "2h 14m left" for the service window; null when closed. The server's expiresAt is the truth. */
export function windowLeft(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? `${h}h ${m}m left` : `${m}m left`
}

// Inbox clocks always show AM/PM, while keeping the browser's time zone.
const time = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
export function shortTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? time.format(d) : day.format(d)
}
export const clockTime = (iso: string) => time.format(new Date(iso))
