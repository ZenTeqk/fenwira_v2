'use client'

import { type Conversation } from '@fenwira/contracts'
import { Button, StatusBadge } from '@fenwira/ui'
import { useNow, windowLeft } from '@/lib/inbox'
import { useConversationActions } from './conversation-actions'

const AUTOMATION = {
  AUTOMATION_ACTIVE: { status: 'ACTIVE', label: 'Automation active' },
  AUTOMATION_PAUSED: { status: 'PAUSED', label: 'Automation paused' },
  AGENT_TAKEOVER: { status: 'AGENT_TAKEOVER', label: 'Agent takeover' },
} as const

/**
 * One ~36px strip (docs/INBOX.md → Layout): the messaging window and the automation state, kept
 * as separate facts, with Resume (the existing return-to-automation call) on the right. Workflow
 * status and assignment live in the header; what can be sent now lives in the composer.
 */
export function ConversationStatusBar({ conversation: c }: { conversation: Conversation }) {
  const now = useNow()
  const actions = useConversationActions(c)
  const left = c.serviceWindow.isOpen ? windowLeft(c.serviceWindow.expiresAt, now) : null
  const expiring =
    !!left &&
    !!c.serviceWindow.expiresAt &&
    new Date(c.serviceWindow.expiresAt).getTime() - now <= 3600_000
  const automation = AUTOMATION[c.automationState]
  return (
    <div
      role="group"
      aria-label="Conversation state"
      className="flex h-11 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-background px-5"
    >
      <span title="WhatsApp 24-hour customer service window" className="shrink-0">
        <StatusBadge
          status={left ? (expiring ? 'EXPIRING' : 'WINDOW_OPEN') : 'WINDOW_CLOSED'}
          label={left ? `Window open · ${left}` : 'Window closed'}
        />
      </span>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border-strong" />
      <span
        className="min-w-0 truncate"
        title={
          c.automationState === 'AUTOMATION_ACTIVE'
            ? undefined
            : 'Automated messages won’t be sent in this conversation.'
        }
      >
        <StatusBadge status={automation.status} label={automation.label} />
      </span>
      {c.aiHandling ? (
        <span
          className="shrink-0"
          title="The AI Assistant is answering this customer. Reply or take over to step in."
        >
          <StatusBadge status="AI_HANDLING" />
        </span>
      ) : null}
      {c.automationState !== 'AUTOMATION_ACTIVE' && actions.can.reply ? (
        <Button
          size="sm"
          variant="link"
          className="ml-auto shrink-0 text-sm"
          aria-label="Resume automation"
          title="Return this conversation to automation"
          loading={actions.pending}
          onClick={() => actions.setAutomation('AUTOMATION_ACTIVE')}
        >
          Resume
        </Button>
      ) : null}
    </div>
  )
}
