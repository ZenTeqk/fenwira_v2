'use client'

import { type Contact, type ContactActivity } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  DetailDrawer,
  ErrorState,
  Skeleton,
  StatusBadge,
  Timeline,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { SOURCE_LABEL } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { ConsentBadge } from './consent-badge'
import { ContactCampaigns } from './contact-campaigns'
import { ContactFormModal } from './contact-form-modal'
import { EligibilitySummary } from './eligibility-summary'
import { TagBadges } from './tag-badges'

function ContactContext({ contact }: { contact: Contact }) {
  const { tenantId, can } = useSession()
  const [campaignsOpen, setCampaignsOpen] = useState(false)
  const conversations = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', contact.id, 'conversations'),
    queryFn: () =>
      get<{
        data: Array<{
          id: string
          status: string
          lastMessageAt: string | null
          lastMessagePreview: string | null
        }>
      }>(`/contacts/${contact.id}/conversations`).then((r) => r.data),
  })
  const activities = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', contact.id, 'activities'),
    queryFn: () =>
      get<{ data: ContactActivity[] }>(`/contacts/${contact.id}/activities`).then((r) => r.data),
  })
  return (
    <>
      {can('inbox.read') && conversations.data?.[0] ? (
        <Button asChild>
          <Link href={`/inbox?c=${conversations.data[0].id}`}>
            <MessageSquare aria-hidden="true" />
            Open conversation
          </Link>
        </Button>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="contact-recent-conversations">
        <h3 id="contact-recent-conversations" className="text-md font-semibold text-slate">
          Recent conversations
        </h3>
        {conversations.isPending ? (
          <Skeleton className="h-16" />
        ) : conversations.isError ? (
          <ErrorState
            title="Conversations couldn’t be loaded"
            onRetry={() => void conversations.refetch()}
          />
        ) : conversations.data.length ? (
          <ul className="divide-y divide-border">
            {conversations.data.slice(0, 3).map((cv) => (
              <li key={cv.id} className="flex flex-col gap-1 py-2 text-sm">
                {can('inbox.read') ? (
                  <Link className="text-primary-strong hover:underline" href={`/inbox?c=${cv.id}`}>
                    {cv.lastMessagePreview ?? 'Open conversation'}
                  </Link>
                ) : (
                  <span>{cv.lastMessagePreview ?? 'Conversation'}</span>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={cv.status as 'OPEN'} />
                  {cv.lastMessageAt ? (
                    <time dateTime={cv.lastMessageAt} className="text-muted">
                      {relativeTime(cv.lastMessageAt)}
                    </time>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">No conversations yet.</p>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="contact-recent-activity">
        <h3 id="contact-recent-activity" className="text-md font-semibold text-slate">
          Recent activity
        </h3>
        {activities.isPending ? (
          <Skeleton className="h-24" />
        ) : activities.isError ? (
          <ErrorState
            title="Activity couldn’t be loaded"
            onRetry={() => void activities.refetch()}
          />
        ) : (
          <Timeline
            label="Recent contact activity"
            empty="No activity yet."
            items={activities.data.slice(0, 5).map((a) => ({
              id: a.id,
              title: a.type.replaceAll(/[._]/g, ' ').replace(/^./, (s) => s.toUpperCase()),
              time: <time dateTime={a.occurredAt}>{relativeTime(a.occurredAt)}</time>,
              description: a.actorName ?? undefined,
            }))}
          />
        )}
      </section>
      {can('campaigns.read') ? (
        <details onToggle={(e) => setCampaignsOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer py-2 text-sm font-medium text-slate">
            Campaign history
          </summary>
          {campaignsOpen ? <ContactCampaigns contactId={contact.id} /> : null}
        </details>
      ) : null}
    </>
  )
}

/** Lightweight communication context; all mutations remain in the existing contact services. */
export function ContactPreview({
  id,
  onClose,
  restoreFocus,
}: {
  id: string | null
  onClose: () => void
  restoreFocus?: () => void
}) {
  const { tenantId, can, me } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', id ?? 'none', 'detail'),
    queryFn: () => get<{ data: Contact }>(`/contacts/${id}`).then((r) => r.data),
    enabled: !!id && can('contacts.read'),
  })
  const c = q.data
  const name = c ? (c.name ?? c.waProfileName ?? c.phoneE164) : 'Contact'
  return (
    <DetailDrawer
      width="md"
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={name}
      description={c?.phoneE164}
      fullHref={id ? `/contacts/${id}` : undefined}
      fullLabel="Open full profile"
      linkAs={Link}
      onCloseAutoFocus={
        restoreFocus
          ? (e) => {
              e.preventDefault()
              restoreFocus()
            }
          : undefined
      }
    >
      {q.isError ? (
        <ErrorState title="Contact couldn’t be loaded" onRetry={() => void q.refetch()} />
      ) : !c ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <Avatar name={name} size="lg" />
            <StatusBadge
              status={c.status === 'BLOCKED' ? 'RESTRICTED' : 'ACTIVE'}
              label={c.status === 'BLOCKED' ? 'Blocked' : 'Active'}
            />
            {can('contacts.write') ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-secondary">Phone</dt>
            <dd className="break-words text-slate">{c.phoneE164}</dd>
            {c.email ? (
              <>
                <dt className="text-secondary">Email</dt>
                <dd className="break-all text-slate">{c.email}</dd>
              </>
            ) : null}
            {c.language ? (
              <>
                <dt className="text-secondary">Language</dt>
                <dd className="text-slate">{c.language}</dd>
              </>
            ) : null}
            {c.country ? (
              <>
                <dt className="text-secondary">Country</dt>
                <dd className="text-slate">{c.country}</dd>
              </>
            ) : null}
            <dt className="text-secondary">Assigned</dt>
            <dd>
              {c.ownerId ? (c.ownerId === me.user.id ? 'You' : 'Assigned teammate') : 'Unassigned'}
            </dd>
            <dt className="text-secondary">Source</dt>
            <dd>{SOURCE_LABEL[c.source] ?? c.source}</dd>
            <dt className="text-secondary">Marketing consent</dt>
            <dd>
              <ConsentBadge state={c.marketingConsent} />
            </dd>
            <dt className="text-secondary">Utility consent</dt>
            <dd>
              <ConsentBadge state={c.utilityConsent} />
            </dd>
          </dl>
          <section className="flex flex-col gap-2">
            <h3 className="text-md font-semibold text-slate">Tags</h3>
            <TagBadges tags={c.tags} max={6} />
          </section>
          <section className="flex flex-col gap-3 border-y border-border py-4">
            <h3 className="text-md font-semibold text-slate">What you can send</h3>
            <EligibilitySummary contactId={c.id} />
          </section>
          <ContactContext contact={c} />
          <ContactFormModal
            contact={c}
            open={editing}
            onOpenChange={setEditing}
            onSaved={() => {
              setEditing(false)
              toast.success('Contact updated')
              void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts') })
              void queryClient.invalidateQueries({
                queryKey: keys.tenant(tenantId, 'contacts-count'),
              })
            }}
          />
        </>
      )}
    </DetailDrawer>
  )
}
