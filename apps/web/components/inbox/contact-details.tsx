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
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  ErrorState,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, StickyNote, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { useEligibility } from '@/components/contacts/eligibility-summary'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { formatDateTime, TAG_TONE, useTags } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { useConversationActions, usePresence } from './conversation-actions'

const sectionClass = 'flex min-w-0 flex-col gap-2 border-t border-border pt-2'
const headingClass = 'text-base font-semibold text-slate'

export function CustomerPanelError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <ErrorState
      title={title}
      description="Please try again."
      onRetry={onRetry}
      className="items-start gap-2 px-0 py-2 text-left [&>div:first-child]:hidden [&_p]:text-xs"
    />
  )
}

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
    <section className={sectionClass}>
      <h3 className={headingClass}>
        <Button
          variant="ghost"
          aria-label={title}
          aria-describedby={`${id}-summary`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="h-auto min-h-8 w-full justify-start gap-2 px-0 py-1 text-base font-semibold hover:bg-surface"
        >
          <span className="min-w-0 flex-1 text-left whitespace-normal">{title}</span>
          <span id={`${id}-summary`} className="shrink-0 font-normal">
            {summary}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-secondary motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </Button>
      </h3>
      <div
        id={id}
        role="region"
        aria-label={title}
        hidden={!open}
        className="flex min-w-0 flex-col gap-2 pb-1"
      >
        {children}
      </div>
    </section>
  )
}

/** Panel presentation of the existing assignment actions; the chat header is unchanged. */
export function CustomerAssignment({ conversation: c }: { conversation: Conversation }) {
  const actions = useConversationActions(c)
  const members = usePresence()
  const menu = actions.can.assignSelf || actions.can.unassign || actions.can.reassign
  const identity = (
    <>
      {c.assignee ? (
        <Avatar appearance="inbox" identityKey={c.assignee.id} name={c.assignee.name} size="sm" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{c.assignee?.name ?? 'Unassigned'}</span>
    </>
  )
  return (
    <section aria-label="Assignment" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className={headingClass}>Assigned to</h3>
        {actions.can.assignSelf ? (
          <Button
            size="sm"
            variant="link"
            className="h-7 px-0 text-xs"
            loading={actions.pending}
            onClick={actions.assignToMe}
          >
            Assign to me
          </Button>
        ) : null}
      </div>
      {menu ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button
              variant="secondary"
              className="h-9 w-full min-w-0 justify-start gap-2 px-2 text-base sm:h-8"
              aria-label={
                c.assignee
                  ? `Assigned to ${c.assignee.name}. Change assignee`
                  : 'Unassigned. Choose an assignee'
              }
              loading={actions.pending}
            >
              {identity}
              <ChevronDown aria-hidden="true" className="ml-auto shrink-0" />
            </Button>
          </DropdownTrigger>
          <DropdownContent
            align="start"
            className="fw-inbox-theme fw-inbox-compact-type max-h-64 max-w-xs overflow-y-auto"
          >
            {actions.can.assignSelf ? (
              <DropdownItem disabled={actions.pending} onSelect={actions.assignToMe}>
                Assign to me
              </DropdownItem>
            ) : null}
            {actions.can.unassign ? (
              <DropdownItem disabled={actions.pending} onSelect={() => actions.assign(null)}>
                Unassign
              </DropdownItem>
            ) : null}
            {actions.can.reassign ? (
              <>
                <DropdownSeparator />
                <DropdownLabel>Workspace members</DropdownLabel>
                {(members.data ?? []).map((member) => (
                  <DropdownItem
                    key={member.userId}
                    disabled={actions.pending || member.userId === c.assignee?.id}
                    onSelect={() => actions.assign(member.userId)}
                  >
                    <Avatar
                      appearance="inbox"
                      identityKey={member.userId}
                      name={member.name}
                      size="sm"
                    />
                    <span className="min-w-0 truncate">{member.name}</span>
                  </DropdownItem>
                ))}
              </>
            ) : null}
          </DropdownContent>
        </Dropdown>
      ) : (
        <div className="flex min-w-0 items-center gap-2 text-base text-secondary">{identity}</div>
      )}
    </section>
  )
}

function useContactWrite(contactId: string) {
  const { tenantId } = useSession()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contact', contactId) }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong.'),
  })
}

export function ContactTags({ contact }: { contact: Contact }) {
  const { can } = useSession()
  const write = useContactWrite(contact.id)
  const catalog = useTags()
  const editable = can('contacts.write')
  const available = (catalog.data ?? []).filter(
    (tag) => !contact.tags.some((existing) => existing.id === tag.id),
  )
  const change = (action: 'TAG' | 'UNTAG', tagId: string) => {
    if (!write.isPending)
      write.mutate(() => post('/contacts/bulk', { action, contactIds: [contact.id], tagId }))
  }
  return (
    <section className={sectionClass} aria-label="Tags">
      <h3 className={headingClass}>Tags</h3>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {contact.tags.map((tag) => (
          <li key={tag.id} className="max-w-full">
            <Badge
              tone={TAG_TONE[tag.color as keyof typeof TAG_TONE] ?? 'neutral'}
              className={cn(
                'min-h-6 max-w-full gap-1 py-0 text-xs',
                tag.color === 'WARNING' && 'bg-inbox-followup text-inbox-followup-text',
              )}
            >
              <span className="min-w-0 break-words whitespace-normal">{tag.name}</span>
              {editable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 size-6 shrink-0 rounded-sm p-0 text-inherit hover:bg-surface/60"
                  aria-label={`Remove tag ${tag.name}`}
                  title={`Remove tag ${tag.name}`}
                  disabled={write.isPending}
                  onClick={() => change('UNTAG', tag.id)}
                >
                  <X aria-hidden="true" className="size-3" />
                </Button>
              ) : null}
            </Badge>
          </li>
        ))}
        {editable && available.length ? (
          <li>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 sm:size-6"
                  loading={write.isPending}
                  aria-label="Add tag"
                  title="Add tag"
                >
                  <Plus aria-hidden="true" />
                </Button>
              </DropdownTrigger>
              <DropdownContent
                align="start"
                className="fw-inbox-theme fw-inbox-compact-type max-h-64 max-w-xs overflow-y-auto"
              >
                {available.map((tag) => (
                  <DropdownItem
                    key={tag.id}
                    disabled={write.isPending}
                    onSelect={() => change('TAG', tag.id)}
                  >
                    <span className="min-w-0 break-words whitespace-normal">{tag.name}</span>
                  </DropdownItem>
                ))}
              </DropdownContent>
            </Dropdown>
          </li>
        ) : null}
        {!contact.tags.length ? <li className="text-xs text-secondary">No tags</li> : null}
      </ul>
      {editable && catalog.isError ? (
        <Button
          size="sm"
          variant="link"
          className="h-7 self-start px-0 text-xs"
          onClick={() => void catalog.refetch()}
        >
          Retry tag list
        </Button>
      ) : null}
    </section>
  )
}

function NoteCard({ note }: { note: ContactNote }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const content = useRef<HTMLParagraphElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (expanded || !content.current) return
    const node = content.current
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [expanded, note.body])
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-md border border-inbox-note-border bg-note-soft p-2 text-base text-slate">
      <p
        id={id}
        ref={content}
        className={cn('whitespace-pre-wrap break-words', !expanded && 'line-clamp-3')}
      >
        {note.body}
      </p>
      {overflows || expanded ? (
        <Button
          variant="link"
          size="sm"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} note by ${note.authorName}`}
          aria-expanded={expanded}
          aria-controls={id}
          className="h-7 self-start px-0 text-xs text-inbox-note-text"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
      <p className="flex min-w-0 items-start gap-1 text-xs text-secondary">
        <StickyNote aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-inbox-note-text" />
        <span className="min-w-0 break-words">
          {note.authorName} ·{' '}
          <time dateTime={note.createdAt} title={formatDateTime(note.createdAt)}>
            {relativeTime(note.createdAt)}
          </time>
        </span>
      </p>
    </li>
  )
}

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
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [all, setAll] = useState(false)
  const [body, setBody] = useState('')
  const id = useId()
  const add = useMutation({
    mutationFn: () => post(`/contacts/${contactId}/notes`, { body: body.trim() }),
    onSuccess: () => {
      setBody('')
      setAdding(false)
      return client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contact', contactId) })
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'The note was not saved.'),
  })
  const rows = notes.data ?? []
  return (
    <section className={sectionClass} aria-label="Contact notes">
      <div className="flex items-center justify-between gap-2">
        <h3 className={headingClass}>
          Notes{' '}
          {!notes.isError && !notes.isPending && notes.data ? (
            <span className="ml-1 text-xs font-normal text-secondary">({rows.length})</span>
          ) : null}
        </h3>
        {can('contacts.write') && !adding ? (
          <Button
            size="sm"
            variant="link"
            className="h-7 gap-1 px-0 text-xs"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add note
          </Button>
        ) : null}
      </div>
      {adding ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (body.trim() && !add.isPending) add.mutate()
          }}
        >
          <label htmlFor={id} className="sr-only">
            New contact note
          </label>
          <Textarea
            id={id}
            autoFocus
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Visible to your team on this contact"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="h-8"
              disabled={add.isPending}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              className="h-8"
              loading={add.isPending}
              disabled={!body.trim()}
            >
              Save note
            </Button>
          </div>
        </form>
      ) : null}
      {notes.isPending ? (
        <Skeleton className="h-16" />
      ) : notes.isError ? (
        <CustomerPanelError title="Notes couldn’t be loaded" onRetry={onRetry} />
      ) : rows.length ? (
        <>
          <ul className="flex min-w-0 flex-col gap-2">
            {(all ? rows : rows.slice(0, 3)).map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </ul>
          {rows.length > 3 ? (
            <Button
              variant="link"
              size="sm"
              className="h-7 self-start px-0 text-xs"
              aria-expanded={all}
              onClick={() => setAll((value) => !value)}
            >
              {all ? 'Show fewer notes' : `Show all ${rows.length} notes`}
            </Button>
          ) : null}
        </>
      ) : adding ? null : (
        <p className="text-xs text-secondary">No notes yet.</p>
      )}
    </section>
  )
}

export function EligibilitySection({
  contact,
  conversationId,
}: {
  contact: Contact
  conversationId: string
}) {
  const query = useEligibility(contact.id, conversationId)
  const verdict = query.data
  const summary = query.isPending ? (
    <span className="text-xs text-secondary">Checking…</span>
  ) : query.isError || !verdict ? (
    <StatusBadge status="UNKNOWN" appearance="inline" label="Unavailable" />
  ) : (
    <StatusBadge
      status={verdict.freeform.allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
      appearance={verdict.freeform.allowed ? 'inline' : 'default'}
      label={
        verdict.freeform.allowed
          ? 'Can reply'
          : verdict.utilityTemplate.allowed || verdict.marketingTemplate.allowed
            ? 'Templates only'
            : 'Unavailable'
      }
    />
  )
  return (
    <Collapsible title="Messaging eligibility" summary={summary}>
      {query.isPending ? (
        <Skeleton className="h-16" />
      ) : query.isError || !verdict ? (
        <CustomerPanelError
          title="Eligibility couldn’t be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(
            [
              ['freeform', 'Free-form replies'],
              ['utilityTemplate', 'Utility templates'],
              ['marketingTemplate', 'Marketing templates'],
            ] as const
          ).map(([key, label]) => (
            <li key={key} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                <span>{label}</span>
                <StatusBadge
                  status={verdict[key].allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
                  appearance="inline"
                  label={verdict[key].allowed ? 'Allowed' : 'Unavailable'}
                />
              </div>
              {!verdict[key].allowed && verdict[key].reason ? (
                <p className="text-xs text-secondary">{verdict[key].reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 items-start gap-2 text-xs" aria-label="Consent">
        {(
          [
            ['marketingConsent', 'Marketing consent'],
            ['utilityConsent', 'Utility consent'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <dt className="text-secondary">{label}</dt>
            <dd>
              {contact[key] === 'NONE' ? (
                <StatusBadge status="NONE" appearance="inline" label="Not recorded" />
              ) : contact[key] === 'GRANTED' ? (
                <StatusBadge status="GRANTED" appearance="inline" label="Opted in" />
              ) : contact[key] === 'REVOKED' ? (
                <StatusBadge status="OPTED_OUT" appearance="inline" label="Opted out" />
              ) : (
                <span className="text-secondary">—</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={`/contacts/${contact.id}`}
        className="self-start text-xs font-medium text-primary-strong hover:underline"
      >
        View eligibility and consent
      </Link>
    </Collapsible>
  )
}

const AUTOMATION = {
  AUTOMATION_ACTIVE: { status: 'ACTIVE', label: 'Active' },
  AUTOMATION_PAUSED: { status: 'PAUSED', label: 'Paused manually' },
  AGENT_TAKEOVER: { status: 'AGENT_TAKEOVER', label: 'Paused for agent' },
} as const
export function AutomationSection({ conversation }: { conversation: Conversation }) {
  const state = AUTOMATION[conversation.automationState]
  if (!state) return null
  return (
    <Collapsible
      title="Automation"
      summary={
        <StatusBadge
          status={state.status}
          appearance="inline"
          label={state.label}
          className="text-secondary"
        />
      }
    >
      <p className="text-xs text-secondary">
        {conversation.automationState === 'AUTOMATION_ACTIVE'
          ? 'Automated messages are permitted in this conversation.'
          : conversation.automationState === 'AGENT_TAKEOVER'
            ? 'Automated messages are paused while an agent handles this conversation.'
            : 'Automated messages were paused manually.'}
      </p>
      {conversation.aiHandling ? (
        <p className="text-xs text-secondary">The AI Assistant is handling this conversation.</p>
      ) : null}
    </Collapsible>
  )
}
