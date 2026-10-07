'use client'

import { type Contact, type ContactNote } from '@fenwira/contracts'
import { ConsentBadge } from '@/components/contacts/consent-badge'
import { EligibilitySummary } from '@/components/contacts/eligibility-summary'
import { Avatar, ErrorState, Skeleton } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { TagBadges } from '@/components/contacts/tag-badges'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { relativeTime } from '@/lib/relative-time'

type PastConversation = {
  id: string
  status: string
  phoneNumber: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
}

/** Compact Contact 360 (docs/INBOX.md → Contact pane). */
export function ContactPane({
  contactId,
  conversationId,
}: {
  contactId: string
  conversationId: string
}) {
  const { tenantId, can } = useSession()
  const enabled = can('contacts.read')
  const base = keys.tenant(tenantId, 'contact', contactId)
  const contact = useQuery({
    queryKey: base,
    queryFn: () => get<{ data: Contact }>(`/contacts/${contactId}`).then((r) => r.data),
    enabled,
  })
  const notes = useQuery({
    queryKey: [...base, 'notes'],
    queryFn: () => get<{ data: ContactNote[] }>(`/contacts/${contactId}/notes`).then((r) => r.data),
    enabled,
  })
  const past = useQuery({
    queryKey: [...base, 'conversations'],
    queryFn: () =>
      get<{ data: PastConversation[] }>(`/contacts/${contactId}/conversations`).then((r) => r.data),
    enabled,
  })
  if (!enabled)
    return <p className="p-4 text-sm text-muted">Your role can&apos;t view contact details.</p>
  if (contact.isPending) return <Skeleton className="m-4 h-40" />
  if (contact.isError)
    return (
      <ErrorState
        title="Contact details couldn’t be loaded"
        onRetry={() => void contact.refetch()}
      />
    )
  if (!contact.data) return <p className="p-4 text-sm text-muted">Contact not found.</p>
  const c = contact.data
  const others = (past.data ?? []).filter((p) => p.id !== conversationId)
  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-3 rounded-lg bg-sidebar p-3">
        <Avatar
          appearance="varied"
          name={c.name ?? c.waProfileName ?? c.phoneE164}
          size="lg"
          className="size-16 ring-4 ring-surface"
        />
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-semibold text-slate">
            {c.name ?? c.waProfileName ?? c.phoneE164}
          </h2>
          <span className="font-mono text-sm text-muted">{c.phoneE164}</span>
          {c.email ? <span className="text-sm text-muted">{c.email}</span> : null}
          <Link
            href={`/contacts/${c.id}`}
            className="text-sm text-primary-strong underline-offset-4 hover:underline"
          >
            Open contact
          </Link>
        </div>
      </div>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-4"
        aria-labelledby="pane-messaging"
      >
        <h3 id="pane-messaging" className="text-sm font-semibold text-slate">
          What you can send
        </h3>
        <EligibilitySummary contactId={c.id} conversationId={conversationId} />
      </section>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-4"
        aria-labelledby="pane-consent"
      >
        <h3 id="pane-consent" className="text-sm font-semibold text-slate">
          Consent
        </h3>
        <dl className="grid grid-cols-2 items-center gap-2 text-sm">
          <dt className="text-secondary">Marketing</dt>
          <dd>
            <ConsentBadge state={c.marketingConsent} />
          </dd>
          <dt className="text-secondary">Utility</dt>
          <dd>
            <ConsentBadge state={c.utilityConsent} />
          </dd>
        </dl>
      </section>
      <section className="flex flex-col gap-2 border-t border-border/70 pt-4" aria-label="Tags">
        <h3 className="text-sm font-semibold text-slate">Tags</h3>
        <TagBadges tags={c.tags} max={10} />
      </section>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-4"
        aria-label="Contact notes"
      >
        <h3 className="text-sm font-semibold text-slate">Notes</h3>
        {notes.isPending ? (
          <Skeleton className="h-20" />
        ) : notes.isError ? (
          <ErrorState title="Notes couldn’t be loaded" onRetry={() => void notes.refetch()} />
        ) : notes.data?.length ? (
          <ul className="flex flex-col gap-2">
            {notes.data.slice(0, 5).map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-warning/20 bg-note-soft p-3 text-sm text-slate"
              >
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-xs text-muted">
                  {n.authorName} · {relativeTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">No notes yet. Notes on the contact show here.</p>
        )}
      </section>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-4"
        aria-label="Other conversations"
      >
        <h3 className="text-sm font-semibold text-slate">Other conversations</h3>
        {past.isPending ? (
          <Skeleton className="h-20" />
        ) : past.isError ? (
          <ErrorState
            title="Conversation history couldn’t be loaded"
            onRetry={() => void past.refetch()}
          />
        ) : others.length ? (
          <ul className="flex flex-col gap-2">
            {others.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/inbox?c=${p.id}`}
                  className="flex flex-col border-l-2 border-primary-soft pl-3 text-sm text-slate hover:underline"
                >
                  <span className="truncate">{p.lastMessagePreview ?? 'No messages'}</span>
                  <span className="text-xs text-muted">
                    Via {p.phoneNumber}
                    {p.lastMessageAt ? ` · ${relativeTime(p.lastMessageAt)}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">No other conversations.</p>
        )}
      </section>
    </div>
  )
}
