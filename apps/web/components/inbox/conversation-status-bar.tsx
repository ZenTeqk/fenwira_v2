'use client'

import { type Conversation } from '@fenwira/contracts'
import { Button, StatusBadge } from '@fenwira/ui'
import { useConversationActions } from './conversation-actions'

const AUTOMATION = {
  AUTOMATION_ACTIVE: { status: 'ACTIVE', label: 'Automation active' },
  AUTOMATION_PAUSED: { status: 'PAUSED', label: 'Automation paused manually' },
  AGENT_TAKEOVER: { status: 'AGENT_TAKEOVER', label: 'Automation paused' },
} as const

/**
 * Automation policy only. Reply eligibility and the single countdown live in the composer.
 */
export function ConversationStatusBar({ conversation: c }: { conversation: Conversation }) {
  const actions = useConversationActions(c)
  const automation = AUTOMATION[c.automationState]
  if (!automation) return null
  return (
    <div
      role="group"
      aria-label="Conversation state"
      className="mx-3 mb-2 flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface px-3 py-1 md:mx-4"
    >
      <span
        className="min-w-0 truncate"
        title={
          c.automationState === 'AUTOMATION_ACTIVE'
            ? undefined
            : 'Automated messages won’t be sent in this conversation.'
        }
      >
        <StatusBadge
          appearance="inline"
          status={automation.status}
          label={automation.label}
          className="text-secondary"
        />
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
          className="ml-auto h-8 shrink-0 px-1 text-xs text-primary-strong sm:h-6"
          aria-label="Resume automation"
          title="Return this conversation to automation"
          loading={actions.pending}
          onClick={() => actions.setAutomation('AUTOMATION_ACTIVE')}
        >
          Resume automation
        </Button>
      ) : null}
      {c.automationState === 'AUTOMATION_ACTIVE' && actions.can.reply ? (
        <Button
          size="sm"
          variant="link"
          className="ml-auto h-8 shrink-0 px-1 text-xs text-primary-strong sm:h-6"
          loading={actions.pending}
          onClick={() => actions.setAutomation('AGENT_TAKEOVER')}
        >
          Take over
        </Button>
      ) : null}
    </div>
  )
}
