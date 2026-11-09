'use client'

import { type Conversation } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import { Clock } from 'lucide-react'
import { waitedFor } from '@/lib/follow-up-format'
import { clockTime, useNow } from '@/lib/inbox'

/**
 * The customer is waiting for a staff reply (docs/RESPONSE_ALERTS.md). Text and an icon, never
 * colour alone. Nothing while a bot handles the conversation or nothing is outstanding.
 */
export function WaitingIndicator({
  waiting,
  className,
}: {
  waiting: Conversation['waiting']
  className?: string
}) {
  const now = useNow(30_000)
  if (!waiting || waiting.botHandling) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs font-medium text-status-warning-fg',
        className,
      )}
      title={`Waiting for a staff reply since ${clockTime(waiting.since)}`}
    >
      <Clock aria-hidden="true" className="size-3" />
      <span>
        Waiting {waitedFor(waiting.since, now)}
        <span className="sr-only"> for a staff reply</span>
      </span>
    </span>
  )
}
