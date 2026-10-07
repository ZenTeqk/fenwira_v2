'use client'

import { type Contact, type ContactActivity } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  Drawer,
  DrawerContent,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  cn,
  focusRing,
  ErrorState,
  Skeleton,
  StatusBadge,
  Timeline,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Globe, Mail, MessageSquare, Pencil, Phone, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { SOURCE_LABEL } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { ConsentBadge } from './consent-badge'
import { ContactCampaigns } from './contact-campaigns'
import { ContactFormModal } from './contact-form-modal'
import { EligibilitySummary, useEligibility } from './eligibility-summary'
import { ContactOwner } from './contact-directory'
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
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-3"
        aria-labelledby="contact-recent-conversations"
      >
        <h3 id="contact-recent-conversations" className="text-sm font-semibold text-slate">
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
                  <StatusBadge appearance="inline" status={cv.status as 'OPEN'} />
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
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-3"
        aria-labelledby="contact-recent-activity"
      >
        <h3 id="contact-recent-activity" className="text-sm font-semibold text-slate">
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
            className="text-sm [&_li]:gap-2 [&_li]:pb-3 [&_p]:text-sm"
            empty="No activity yet."
            items={activities.data.slice(0, 3).map((a) => ({
              id: a.id,
              title: a.type.replaceAll(/[._]/g, ' ').replace(/^./, (s) => s.toUpperCase()),
              time: <time dateTime={a.occurredAt}>{relativeTime(a.occurredAt)}</time>,
              description: a.actorName ?? undefined,
            }))}
          />
        )}
      </section>
      {can('campaigns.read') ? (
        <details
          className="border-t border-border/70 pt-2"
          onToggle={(e) => setCampaignsOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer py-2 text-sm font-medium text-slate">
            Campaign history
          </summary>
          {campaignsOpen ? <ContactCampaigns contactId={contact.id} /> : null}
        </details>
      ) : null}
    </>
  )
}

function ContactMessage({ contactId }: { contactId: string }) {
  const { tenantId, can } = useSession()
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', contactId, 'conversations'),
    queryFn: () =>
      get<{ data: Array<{ id: string }> }>(`/contacts/${contactId}/conversations`).then(
        (r) => r.data,
      ),
    enabled: can('inbox.read'),
  })
  return can('inbox.read') && q.data?.[0] ? (
    <Button asChild className="flex-1">
      <Link href={`/inbox?c=${q.data[0].id}`}>
        <MessageSquare aria-hidden="true" />
        Message
      </Link>
    </Button>
  ) : null
}

const desktopQuery = '(min-width: 1280px)'
const subscribeDesktop = (listener: () => void) => {
  const query = window.matchMedia(desktopQuery)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function WhatsAppRelationship({ contact }: { contact: Contact }) {
  const q = useEligibility(contact.id)
  return (
    <section
      className="flex flex-col gap-2 border-t border-border/70 pt-3"
      aria-label="WhatsApp relationship"
    >
      <h3 className="text-sm font-semibold">WhatsApp eligibility</h3>
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : q.isError ? (
        <ErrorState title="Eligibility couldn’t be loaded" onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <div className="flex flex-col gap-2">
          {(
            [
              ['Service replies', q.data.freeform],
              ['Marketing', q.data.marketingTemplate],
            ] as const
          ).map(([label, verdict]) => (
            <div
              key={label}
              className={cn(
                'rounded-md border px-3 py-2',
                verdict.allowed
                  ? 'border-border bg-primary-soft/50'
                  : 'border-border bg-background',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <StatusBadge
                  appearance="inline"
                  status={verdict.allowed ? 'CAN_SEND' : 'CANNOT_SEND'}
                />
              </div>
              {!verdict.allowed && verdict.reason ? (
                <p className="mt-1 text-xs text-secondary">{verdict.reason}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <details>
        <summary
          className={cn('min-h-8 cursor-pointer rounded-sm py-1 text-xs text-secondary', focusRing)}
        >
          Eligibility and consent details
        </summary>
        <div className="flex flex-col gap-3 pt-2">
          <EligibilitySummary contactId={contact.id} />
          <dl className="grid grid-cols-2 items-center gap-2 text-sm">
            <dt className="text-secondary">Marketing consent</dt>
            <dd>
              <ConsentBadge state={contact.marketingConsent} />
            </dd>
            <dt className="text-secondary">Utility consent</dt>
            <dd>
              <ConsentBadge state={contact.utilityConsent} />
            </dd>
          </dl>
        </div>
      </details>
    </section>
  )
}

/** Inline desktop context and responsive drawer share one contact read/edit implementation. */
export function ContactPreview({
  id,
  onClose,
  restoreFocus,
}: {
  id: string | null
  onClose: () => void
  restoreFocus?: () => void
}) {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  )
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', id ?? 'none', 'detail'),
    queryFn: () => get<{ data: Contact }>(`/contacts/${id}`).then((r) => r.data),
    enabled: !!id && can('contacts.read'),
  })
  useEffect(() => {
    if (id && desktop) panelRef.current?.focus()
  }, [id, desktop])
  const close = () => {
    setEditing(false)
    onClose()
    if (desktop) restoreFocus?.()
  }
  const c = q.data
  const name = c ? (c.name ?? c.waProfileName ?? c.phoneE164) : 'Contact'
  const field = (label: string, value: ReactNode, Icon: typeof Phone) => (
    <div className="grid grid-cols-2 items-start gap-2 text-sm">
      <dt className="flex items-center gap-2 text-secondary">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-slate">{value}</dd>
    </div>
  )
  const content = q.isError ? (
    <ErrorState title="Contact couldn’t be loaded" onRetry={() => void q.refetch()} />
  ) : !c ? (
    <Skeleton className="h-48" />
  ) : (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3" aria-label="Contact identity">
        <Avatar appearance="varied" name={name} size="lg" className="size-12" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-semibold">
            {name}
          </h2>
          <p className="text-xs text-muted">{c.phoneE164}</p>
          <p className="mt-1 text-xs text-secondary">
            {SOURCE_LABEL[c.source]}
            {c.status === 'BLOCKED' ? (
              <StatusBadge appearance="inline" status="RESTRICTED" label="Blocked" />
            ) : null}
          </p>
        </div>
        {desktop ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close contact details"
            className="size-8 self-start"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ContactMessage contactId={c.id} />
        <Dropdown modal={false}>
          <DropdownTrigger asChild>
            <Button variant="secondary" className="gap-2">
              More
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            {can('contacts.write') ? (
              <DropdownItem onSelect={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit contact
              </DropdownItem>
            ) : null}
            <DropdownItem asChild>
              <Link href={`/contacts/${c.id}`}>Open full profile</Link>
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-3"
        aria-label="Contact information"
      >
        <h3 className="text-sm font-semibold">Contact</h3>
        <dl className="flex flex-col gap-2">
          {field('Phone', c.phoneE164, Phone)}
          {c.email
            ? field(
                'Email',
                <a
                  href={`mailto:${c.email}`}
                  className="break-all text-primary-strong hover:underline"
                >
                  {c.email}
                </a>,
                Mail,
              )
            : null}
          {c.language ? field('Language', c.language, Globe) : null}
          {c.country ? field('Country', c.country, Globe) : null}
        </dl>
      </section>
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-3"
        aria-label="Contact tags"
      >
        <h3 className="text-sm font-semibold">Tags</h3>
        <TagBadges tags={c.tags} max={6} />
      </section>
      <WhatsAppRelationship contact={c} />
      <section
        className="flex flex-col gap-2 border-t border-border/70 pt-3"
        aria-label="Contact assignment"
      >
        <h3 className="text-sm font-semibold">Assigned to</h3>
        <ContactOwner ownerId={c.ownerId} />
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
          void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts-count') })
        }}
      />
    </div>
  )
  return (
    <>
      {id && desktop ? (
        <aside
          ref={panelRef}
          tabIndex={-1}
          aria-label="Contact details"
          aria-labelledby={c ? titleId : undefined}
          onKeyDown={(e) => {
            if (
              e.key === 'Escape' &&
              !editing &&
              !e.defaultPrevented &&
              !(e.target as Element).closest('[role="menu"]')
            ) {
              e.stopPropagation()
              close()
            }
          }}
          className="sticky top-4 max-h-screen w-72 shrink-0 overflow-y-auto rounded-lg border border-border bg-surface outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
        >
          {content}
        </aside>
      ) : null}
      <Drawer open={!!id && !desktop} onOpenChange={(open) => !open && !desktop && close()}>
        <DrawerContent
          title={name}
          side="right"
          width="sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (desktop) panelRef.current?.focus()
            else restoreFocus?.()
          }}
        >
          <div className="-m-4">{!desktop ? content : null}</div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
