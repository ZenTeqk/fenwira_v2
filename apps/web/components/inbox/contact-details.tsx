'use client'

import { type Contact, type ContactNote, type Conversation } from '@fenwira/contracts'
import {
  Avatar,
  Badge,
  Button,
  cn,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  ErrorState,
  focusRing,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'
import { ConsentBadge } from '@/components/contacts/consent-badge'
import { EligibilitySummary, useEligibility } from '@/components/contacts/eligibility-summary'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { TAG_TONE, useTags } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { useConversationActions } from './conversation-actions'

const sectionClass = 'flex flex-col gap-2 border-t border-border pt-4'
const headingClass = 'text-base font-semibold text-slate'

/** A section whose details expand; the summary stays visible. */
function Collapsible({
  title,
  summary,
  children,
}: {
  title: string
  summary: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={sectionClass}>
      <h3 className={headingClass}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cn('flex w-full items-center justify-between gap-2 rounded-sm', focusRing)}
        >
          {title}
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 text-secondary transition-transform', open && 'rotate-180')}
          />
        </button>
      </h3>
      {summary}
      <div id={id} hidden={!open} className="flex flex-col gap-3 pt-1">
        {children}
      </div>
    </div>
  )
}

function useContactWrite(contactId: string) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contact', contactId) }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Something went wrong.'),
  })
}

/** The contact's tags: existing chips, Add, and removal with contacts.write (bulk TAG/UNTAG). */
export function ContactTags({ contact }: { contact: Contact }) {
  const { can } = useSession()
  const write = useContactWrite(contact.id)
  const all = useTags().data ?? []
  const editable = can('contacts.write')
  const available = all.filter((t) => !contact.tags.some((x) => x.id === t.id))
  const tag = (action: 'TAG' | 'UNTAG', tagId: string) =>
    write.mutate(() => post('/contacts/bulk', { action, contactIds: [contact.id], tagId }))
  return (
    <section className={sectionClass} aria-label="Tags">
      <h3 className={headingClass}>Tags</h3>
      <ul className="flex flex-wrap items-center gap-2">
        {contact.tags.map((t) => (
          <li key={t.id}>
            <Badge tone={TAG_TONE[t.color as keyof typeof TAG_TONE] ?? 'neutral'}>
              {t.name}
              {editable ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${t.name}`}
                  title={`Remove tag ${t.name}`}
                  disabled={write.isPending}
                  onClick={() => tag('UNTAG', t.id)}
                  className={cn('-mr-1 rounded-sm p-0.5 hover:bg-surface/60', focusRing)}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </Badge>
          </li>
        ))}
        {editable && available.length ? (
          <li>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button size="sm" variant="secondary" loading={write.isPending}>
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </DropdownTrigger>
              <DropdownContent align="start" className="max-h-64 overflow-y-auto">
                {available.map((t) => (
                  <DropdownItem key={t.id} onSelect={() => tag('TAG', t.id)}>
                    {t.name}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </Dropdown>
          </li>
        ) : null}
        {!contact.tags.length && !(editable && available.length) ? (
          <li className="text-sm text-secondary">No tags</li>
        ) : null}
      </ul>
    </section>
  )
}

/** Contact notes with "Add note" (POST /contacts/:id/notes, contacts.write). */
export function ContactNotes({
  contactId,
  notes,
  onRetry,
}: {
  contactId: string
  notes: { isPending: boolean; isError: boolean; data?: ContactNote[] }
  onRetry: () => void
}) {
  const { can, tenantId } = useSession()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [body, setBody] = useState('')
  const id = useId()
  const add = useMutation({
    mutationFn: () => post(`/contacts/${contactId}/notes`, { body: body.trim() }),
    onSuccess: () => {
      setBody('')
      setAdding(false)
      void queryClient.invalidateQueries({
        queryKey: [...keys.tenant(tenantId, 'contact', contactId), 'notes'],
      })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The note was not saved.'),
  })
  return (
    <section className={sectionClass} aria-label="Contact notes">
      <div className="flex items-center justify-between gap-2">
        <h3 className={headingClass}>Notes</h3>
        {can('contacts.write') && !adding ? (
          <Button size="sm" variant="tertiary" className="px-1" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add note
          </Button>
        ) : null}
      </div>
      {adding ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
        >
          <label htmlFor={id} className="sr-only">
            New contact note
          </label>
          <Textarea
            id={id}
            autoFocus
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Visible to your team on this contact"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" loading={add.isPending} disabled={!body.trim()}>
              Save note
            </Button>
          </div>
        </form>
      ) : null}
      {notes.isPending ? (
        <Skeleton className="h-20" />
      ) : notes.isError ? (
        <ErrorState title="Notes couldn’t be loaded" onRetry={onRetry} />
      ) : notes.data?.length ? (
        <ul className="flex flex-col gap-2">
          {notes.data.slice(0, 5).map((n) => (
            <li key={n.id} className="flex gap-2 rounded-md bg-note-soft p-2 text-sm text-slate">
              <Avatar appearance="varied" name={n.authorName} size="sm" />
              <div className="min-w-0">
                <p className="mb-1 text-xs text-secondary">
                  <span className="font-medium">{n.authorName}</span> ·{' '}
                  <time dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
                </p>
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : adding ? null : (
        <p className="text-sm text-secondary">No notes yet. Notes on the contact show here.</p>
      )}
    </section>
  )
}

/** Server eligibility verdicts (decision C1): a short summary, details on demand. */
export function EligibilitySection({
  contact,
  conversationId,
}: {
  contact: Contact
  conversationId: string
}) {
  const q = useEligibility(contact.id, conversationId)
  const summary = q.isPending ? (
    <Skeleton className="h-6" />
  ) : q.isError ? (
    <ErrorState title="Eligibility couldn’t be loaded" onRetry={() => void q.refetch()} />
  ) : q.data ? (
    <div className="flex flex-col gap-1">
      <StatusBadge
        appearance="inline"
        status={q.data.freeform.allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
        label={q.data.freeform.allowed ? 'Can reply now' : 'Free-text replies unavailable'}
      />
      {!q.data.freeform.allowed && q.data.freeform.reason ? (
        <p className="text-sm text-secondary">{q.data.freeform.reason}</p>
      ) : null}
    </div>
  ) : null
  return (
    <Collapsible title="Messaging eligibility" summary={summary}>
      <EligibilitySummary contactId={contact.id} conversationId={conversationId} />
      <dl className="grid grid-cols-2 items-center gap-2 text-sm" aria-label="Consent">
        <dt className="text-secondary">Marketing consent</dt>
        <dd>
          <ConsentBadge state={contact.marketingConsent} />
        </dd>
        <dt className="text-secondary">Utility consent</dt>
        <dd>
          <ConsentBadge state={contact.utilityConsent} />
        </dd>
      </dl>
      <Link
        href={`/contacts/${contact.id}`}
        className="self-start text-sm font-medium text-primary-strong underline-offset-4 hover:underline"
      >
        View eligibility and consent
      </Link>
    </Collapsible>
  )
}

const AUTOMATION_STATE = {
  AUTOMATION_ACTIVE: { status: 'ACTIVE', label: 'Active' },
  AUTOMATION_PAUSED: { status: 'PAUSED', label: 'Paused' },
  AGENT_TAKEOVER: { status: 'AGENT_TAKEOVER', label: 'Agent takeover' },
} as const

/** Automation state and the controls the existing endpoint permits (inbox.reply). */
export function AutomationSection({ conversation: c }: { conversation: Conversation }) {
  const actions = useConversationActions(c)
  const state = AUTOMATION_STATE[c.automationState]
  return (
    <Collapsible
      title="Automation"
      summary={<StatusBadge appearance="inline" status={state.status} label={state.label} />}
    >
      <p className="text-sm text-secondary">
        {c.automationState === 'AUTOMATION_ACTIVE'
          ? 'Automated flows can reply in this conversation.'
          : 'Automated messages won’t be sent in this conversation.'}
      </p>
      {actions.can.reply ? (
        <div className="flex flex-wrap gap-2">
          {c.automationState === 'AUTOMATION_ACTIVE' ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => actions.setAutomation('AGENT_TAKEOVER')}
              >
                Take over
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => actions.setAutomation('AUTOMATION_PAUSED')}
              >
                Pause
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => actions.setAutomation('AUTOMATION_ACTIVE')}
            >
              Resume automation
            </Button>
          )}
        </div>
      ) : null}
    </Collapsible>
  )
}
