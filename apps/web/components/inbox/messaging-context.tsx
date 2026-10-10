'use client'

import { type Contact } from '@fenwira/contracts'
import { ErrorState, focusRing, cn, Skeleton, StatusBadge } from '@fenwira/ui'
import { ConsentBadge } from '@/components/contacts/consent-badge'
import { EligibilitySummary, useEligibility } from '@/components/contacts/eligibility-summary'

/** Inbox presentation of the same server verdicts; Contacts' default presentation is unchanged. */
export function MessagingContext({
  contact,
  conversationId,
}: {
  contact: Contact
  conversationId: string
}) {
  const q = useEligibility(contact.id, conversationId)
  return (
    <section
      aria-label="WhatsApp context"
      className="flex flex-col gap-2 border-t border-border/70 pt-3"
    >
      <h3 className="text-sm font-semibold text-slate">WhatsApp</h3>
      {q.isPending ? (
        <Skeleton className="h-12" />
      ) : q.isError ? (
        <ErrorState title="Eligibility couldn’t be loaded" onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-secondary">Service replies</span>
            <StatusBadge
              appearance="inline"
              status={q.data.freeform.allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-secondary">Marketing</span>
            <StatusBadge
              appearance="inline"
              status={q.data.marketingTemplate.allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
            />
          </div>
          {!q.data.freeform.allowed && q.data.freeform.reason ? (
            <p className="text-xs text-warning-strong">{q.data.freeform.reason}</p>
          ) : null}
        </div>
      ) : null}
      <details>
        <summary
          className={cn('min-h-8 cursor-pointer rounded-sm py-1 text-xs text-secondary', focusRing)}
        >
          Eligibility and consent details
        </summary>
        <div className="flex flex-col gap-3 pt-2">
          <EligibilitySummary contactId={contact.id} conversationId={conversationId} />
          <dl className="grid grid-cols-2 items-center gap-2 text-sm" aria-label="Consent">
            <dt className="text-secondary">Marketing</dt>
            <dd>
              <ConsentBadge state={contact.marketingConsent} />
            </dd>
            <dt className="text-secondary">Utility</dt>
            <dd>
              <ConsentBadge state={contact.utilityConsent} />
            </dd>
          </dl>
        </div>
      </details>
    </section>
  )
}
