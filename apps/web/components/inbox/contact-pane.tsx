'use client'

import { type Contact, type ContactNote, type Conversation } from '@fenwira/contracts'
import { Avatar, ErrorState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@fenwira/ui'
import { ArrowUpRight } from 'lucide-react'
import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { formatPhone } from '@/lib/phone'
import { relativeTime } from '@/lib/relative-time'
import { AssignControl } from './conversation-header'
import { AutomationSection, ContactNotes, ContactTags, EligibilitySection } from './contact-details'

type PastConversation = {
  id: string
  status: string
  phoneNumber: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
}

export type PanelTab = 'details' | 'files'

/**
 * Contact details (docs/INBOX.md → Contact pane): profile, then Details | Shared files. The
 * profile comes from the conversation, so Shared files works without contacts.read.
 */
export function ContactPane({
  contactId,
  conversation,
  tab,
  onTabChange,
  files,
}: {
  contactId: string
  conversation: Conversation
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /** The Shared files tab's content. */
  files: ReactNode
}) {
  const conversationId = conversation.id
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
  const who = conversation.contact
  const name = who.name ?? who.waProfileName ?? formatPhone(who.phoneE164)
  const c = contact.data
  const others = (past.data ?? []).filter((p) => p.id !== conversationId)
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-5 pt-4 pb-3" aria-label="Customer identity">
        <Avatar appearance="varied" name={name} size="lg" className="size-14 text-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-md font-semibold text-slate" title={name}>
            {name}
          </h3>
          <span className="text-base text-secondary tabular-nums">
            {formatPhone(who.phoneE164)}
          </span>
          {enabled ? (
            <Link
              href={`/contacts/${who.id}`}
              className="inline-flex items-center gap-1 self-start text-base font-medium text-primary-strong underline-offset-4 hover:underline"
            >
              Open contact
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PanelTab)} className="gap-0">
        <TabsList className="px-5" aria-label="Contact panel">
          <TabsTrigger value="details" className="flex-1 justify-center">
            Details
          </TabsTrigger>
          <TabsTrigger value="files" className="flex-1 justify-center">
            Shared files
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files">{files}</TabsContent>
        <TabsContent value="details" className="flex flex-col gap-4 p-5">
          {!enabled ? (
            <p className="text-sm text-secondary">Your role can&apos;t view contact details.</p>
          ) : contact.isPending ? (
            <Skeleton className="h-40" />
          ) : contact.isError || !c ? (
            <ErrorState
              title="Contact details couldn’t be loaded"
              onRetry={() => void contact.refetch()}
            />
          ) : (
            <>
              <section
                className="flex flex-col gap-2"
                aria-labelledby={`${conversationId}-assigned`}
              >
                <h3 id={`${conversationId}-assigned`} className="text-sm font-semibold text-slate">
                  Assigned to
                </h3>
                {/* The header's control: one source of truth (the conversation query). */}
                <AssignControl c={conversation} variant="panel" />
              </section>
              <ContactTags contact={c} />
              <ContactNotes
                contactId={contactId}
                notes={notes}
                onRetry={() => void notes.refetch()}
              />
              <EligibilitySection contact={c} conversationId={conversationId} />
              <AutomationSection conversation={conversation} />
              {/* Only when there is history to show (or it failed to load). */}
              {past.isError || others.length ? (
                <section
                  className="flex flex-col gap-2 border-t border-border pt-4"
                  aria-label="Other conversations"
                >
                  <h3 className="text-sm font-semibold text-slate">Other conversations</h3>
                  {past.isError ? (
                    <ErrorState
                      title="Conversation history couldn’t be loaded"
                      onRetry={() => void past.refetch()}
                    />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {others.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/inbox?c=${p.id}`}
                            className="flex flex-col border-l-2 border-primary-soft pl-3 text-sm text-slate hover:underline"
                          >
                            <span className="truncate">
                              {p.lastMessagePreview ?? 'No messages'}
                            </span>
                            <span className="text-xs text-secondary">
                              Via {p.phoneNumber}
                              {p.lastMessageAt ? ` · ${relativeTime(p.lastMessageAt)}` : ''}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
