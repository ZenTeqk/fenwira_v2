'use client'

import { ConfirmDialog } from '@fenwira/ui'
import { useEffect, useRef, useState } from 'react'
import {
  noteInteraction,
  reportDue,
  type SessionDeadlines,
  sessionState,
} from '@/lib/session-activity'

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/**
 * Inactivity warning and expiry (customer app and /platform). The server enforces the limits
 * (12 h absolute, 3 h idle); this shows "you'll be signed out in 5 minutes" with Stay signed in,
 * reports real interactions so the server's idle clock moves, and sends the user to sign-in with
 * a "session expired" message once either deadline passes.
 */
export function SessionTimeout({
  deadlines,
  keepAlive,
  onExpired,
}: {
  deadlines: SessionDeadlines | null
  /** Tells the server the user is active; resolves false when the session has already ended. */
  keepAlive: () => Promise<boolean>
  onExpired: () => void
}) {
  const [warning, setWarning] = useState<number | null>(null)
  const busy = useRef(false)
  const expired = useRef(false)

  const extend = async () => {
    if (busy.current) return
    busy.current = true
    try {
      if (!(await keepAlive())) expire()
    } finally {
      busy.current = false
    }
  }
  const expire = () => {
    if (expired.current) return
    expired.current = true
    onExpired()
  }

  useEffect(() => {
    const onActivity = () => {
      noteInteraction()
      if (reportDue()) void extend()
    }
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    return () => EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
  }, [keepAlive])

  useEffect(() => {
    if (!deadlines) return
    const tick = () => {
      const s = sessionState(deadlines)
      if (s.kind === 'expired') expire()
      setWarning(s.kind === 'warning' ? s.msLeft : null)
    }
    tick()
    const t = window.setInterval(tick, 15_000)
    return () => window.clearInterval(t)
  }, [deadlines])

  const minutes = warning === null ? 0 : Math.max(1, Math.ceil(warning / 60_000))
  return (
    <ConfirmDialog
      open={warning !== null}
      onOpenChange={(open) => {
        if (!open) void extend()
      }}
      title="Are you still there?"
      description={`You'll be signed out in ${minutes} minute${minutes === 1 ? '' : 's'} due to inactivity.`}
      confirmLabel="Stay signed in"
      cancelLabel="Dismiss"
      onConfirm={() => {
        noteInteraction()
        void extend()
      }}
    />
  )
}
