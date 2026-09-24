'use client'

import {
  type ConsentRecord,
  type Contact,
  type ContactActivity,
  type ContactNote,
} from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  ModalClose,
  ModalContent,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { ContactFormModal } from '@/components/contacts/contact-form-modal'
import { TagBadges } from '@/components/contacts/tag-badges'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { ApiError, get, patch, post } from '@/lib/api/client'
import { del } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  CONSENT_LABEL,
  CONSENT_TONE,
  formatDateTime,
  SOURCE_LABEL,
  useProperties,
  useTags,
} from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'

const SOURCE_TEXT: Record<string, string> = {
  INBOUND_KEYWORD: 'Keyword reply',
  MANUAL: 'Changed manually',
  IMPORT: 'CSV import',
  API: 'API',
  FORM: 'Form',
  META_OPT_OUT: 'WhatsApp opt-out',
}

const ACTIVITY_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  'contact.created': () => 'Contact created',
  'contact.imported': () => 'Imported from a CSV',
  'contact.updated': (d) => `Updated ${((d.fields as string[]) ?? []).join(', ')}`,
  'contact.blocked': () => 'Blocked',
  'contact.deleted': () => 'Deleted',
  'consent.granted': (d) =>
    `Opted in to ${String(d.purpose).toLowerCase()} (${SOURCE_TEXT[String(d.source)] ?? d.source})`,
  'consent.revoked': (d) =>
    `Opted out of ${String(d.purpose).toLowerCase()} (${SOURCE_TEXT[String(d.source)] ?? d.source})`,
  'tag.added': (d) => `Tagged "${d.tag}"`,
  'tag.removed': (d) => `Removed tag "${d.tag}"`,
  'note.added': () => 'Note added',
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-base text-slate">{children || '—'}</dd>
    </div>
  )
}

function ConsentModal({
  contact,
  open,
  onOpenChange,
  onSaved,
}: {
  contact: Contact
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [purpose, setPurpose] = useState<'MARKETING' | 'UTILITY'>('MARKETING')
  const current = purpose === 'MARKETING' ? contact.marketingConsent : contact.utilityConsent
  const [note, setNote] = useState('')
  const change = useMutation({
    mutationFn: () =>
      post(`/contacts/${contact.id}/consents`, {
        purpose,
        status: current === 'GRANTED' ? 'REVOKED' : 'GRANTED',
        note,
      }),
    onSuccess: () => {
      setNote('')
      onSaved()
      onOpenChange(false)
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Change consent"
        description="Every change is kept in the consent history with your note."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="consent-form" loading={change.isPending}>
              {current === 'GRANTED' ? 'Record opt-out' : 'Record opt-in'}
            </Button>
          </>
        }
      >
        <form
          id="consent-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            change.mutate()
          }}
        >
          <FormError error={change.error} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate" id="consent-purpose">
              Message type
            </span>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as 'MARKETING' | 'UTILITY')}>
              <SelectTrigger aria-labelledby="consent-purpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="UTILITY">Utility (updates, reminders)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted">Currently: {CONSENT_LABEL[current]}</span>
          </div>
          <Field label="Note" hint="How and when the contact told you.">
            <textarea
              className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-base text-slate"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              minLength={3}
              maxLength={500}
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}

export default function ContactPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantId, can } = useSession()
  const router = useRouter()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const properties = useProperties().data ?? []
  const tags = useTags().data ?? []
  const [editing, setEditing] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [note, setNote] = useState('')
  const base = keys.tenant(tenantId, 'contact', id)

  const contact = useQuery({
    queryKey: base,
    queryFn: () => get<{ data: Contact }>(`/contacts/${id}`).then((r) => r.data),
    enabled: can('contacts.read'),
  })
  const consents = useQuery({
    queryKey: [...base, 'consents'],
    queryFn: () => get<{ data: ConsentRecord[] }>(`/contacts/${id}/consents`).then((r) => r.data),
    enabled: can('contacts.read'),
  })
  const activities = useQuery({
    queryKey: [...base, 'activities'],
    queryFn: () =>
      get<{ data: ContactActivity[] }>(`/contacts/${id}/activities`).then((r) => r.data),
    enabled: can('contacts.read'),
  })
  const notes = useQuery({
    queryKey: [...base, 'notes'],
    queryFn: () => get<{ data: ContactNote[] }>(`/contacts/${id}/notes`).then((r) => r.data),
    enabled: can('contacts.read'),
  })
  const conversations = useQuery({
    queryKey: [...base, 'conversations'],
    queryFn: () =>
      get<{
        data: Array<{
          id: string
          status: string
          phoneNumber: string
          lastMessageAt: string | null
          lastMessagePreview: string | null
          serviceWindowExpiresAt: string | null
        }>
      }>(`/contacts/${id}/conversations`).then((r) => r.data),
    enabled: can('contacts.read'),
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: base })
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
  const tagAction = useMutation({
    mutationFn: (v: { action: 'TAG' | 'UNTAG'; tagId: string }) =>
      post('/contacts/bulk', { ...v, contactIds: [id] }),
    onSuccess: refresh,
    onError,
  })
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'BLOCKED') => patch(`/contacts/${id}`, { status }),
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({
    mutationFn: () => del(`/contacts/${id}`),
    onSuccess: () => {
      toast.success('Contact deleted')
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts') })
      router.push('/contacts')
    },
    onError,
  })
  const addNote = useMutation({
    mutationFn: () => post(`/contacts/${id}/notes`, { body: note }),
    onSuccess: () => {
      setNote('')
      refresh()
    },
    onError,
  })

  if (!can('contacts.read')) return <NoAccess what="contacts" />
  if (contact.isPending) return <Skeleton className="h-64 w-full" />
  if (contact.isError)
    return contact.error instanceof ApiError && contact.error.status === 404 ? (
      <EmptyState title="Contact not found" description="It may have been deleted." />
    ) : (
      <ErrorState onRetry={() => void contact.refetch()} />
    )
  const c = contact.data
  const title = c.name ?? c.waProfileName ?? c.phoneE164
  const canWrite = can('contacts.write')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Contacts', href: '/contacts' }, { label: title }]}
        linkAs={Link}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.phoneE164}</span>
            {c.status === 'BLOCKED' ? <Badge tone="danger">Blocked</Badge> : null}
            <TagBadges tags={c.tags} max={8} />
          </span>
        }
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownLabel>Tags</DropdownLabel>
                  {tags.map((t) => {
                    const has = c.tags.some((x) => x.id === t.id)
                    return (
                      <DropdownItem
                        key={t.id}
                        onSelect={() =>
                          tagAction.mutate({ action: has ? 'UNTAG' : 'TAG', tagId: t.id })
                        }
                      >
                        {has ? `Remove "${t.name}"` : `Add "${t.name}"`}
                      </DropdownItem>
                    )
                  })}
                  <DropdownSeparator />
                  <DropdownItem
                    onSelect={() => setStatus.mutate(c.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED')}
                  >
                    {c.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                  </DropdownItem>
                  {can('contacts.delete') ? (
                    <DropdownItem
                      destructive
                      onSelect={async () => {
                        if (
                          await confirm({
                            title: `Delete ${title}?`,
                            description:
                              'The contact disappears from lists and segments. Messages are kept.',
                            confirmLabel: 'Delete',
                            destructive: true,
                          })
                        )
                          remove.mutate()
                      }}
                    >
                      Delete
                    </DropdownItem>
                  ) : null}
                </DropdownContent>
              </Dropdown>
            </div>
          ) : null
        }
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="consent">Consent</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Name">{c.name}</Detail>
                <Detail label="WhatsApp name">{c.waProfileName}</Detail>
                <Detail label="Email">{c.email}</Detail>
                <Detail label="Language">{c.language}</Detail>
                <Detail label="Country">{c.country}</Detail>
                <Detail label="Source">{SOURCE_LABEL[c.source]}</Detail>
                <Detail label="Created">{formatDateTime(c.createdAt)}</Detail>
                <Detail label="Last message from contact">
                  {c.lastInboundAt ? relativeTime(c.lastInboundAt) : null}
                </Detail>
                {properties
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <Detail key={p.key} label={p.label}>
                      {c.properties[p.key] === undefined || c.properties[p.key] === null
                        ? null
                        : String(c.properties[p.key])}
                    </Detail>
                  ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Consent</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted">Marketing</span>
              <Badge tone={CONSENT_TONE[c.marketingConsent]}>
                {CONSENT_LABEL[c.marketingConsent]}
              </Badge>
              <span className="text-sm text-muted">Utility</span>
              <Badge tone={CONSENT_TONE[c.utilityConsent]}>{CONSENT_LABEL[c.utilityConsent]}</Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          {conversations.data?.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              {conversations.data.map((cv) => (
                <li key={cv.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-slate">
                      {cv.lastMessagePreview ?? 'No messages yet'}
                    </span>
                    <span className="text-sm text-muted">
                      Via {cv.phoneNumber}
                      {cv.lastMessageAt ? ` · ${relativeTime(cv.lastMessageAt)}` : ''}
                    </span>
                  </div>
                  <StatusBadge status={cv.status as 'OPEN'} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No conversations yet"
              description="Conversations appear when you or the contact send a message."
            />
          )}
        </TabsContent>

        <TabsContent value="campaigns">
          <EmptyState
            title="No campaign messages"
            description="Campaign sends to this contact will be listed here."
          />
        </TabsContent>

        <TabsContent value="activities">
          {activities.data?.length ? (
            <ol className="flex flex-col gap-3" aria-label="Activity timeline">
              {activities.data.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col rounded-md border border-border bg-surface p-3"
                >
                  <span className="text-slate">{ACTIVITY_TEXT[a.type]?.(a.data) ?? a.type}</span>
                  <span className="text-sm text-muted">
                    {a.actorName ?? (a.actorType === 'SYSTEM' ? 'Fenwira' : 'Someone')} ·{' '}
                    <time dateTime={a.occurredAt}>{formatDateTime(a.occurredAt)}</time>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No activity yet" />
          )}
        </TabsContent>

        <TabsContent value="consent" className="flex flex-col gap-4">
          {canWrite ? (
            <Button variant="secondary" className="self-start" onClick={() => setConsentOpen(true)}>
              Change consent
            </Button>
          ) : null}
          {consents.data?.length ? (
            <table className="w-full text-left text-base" aria-label="Consent history">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Change</th>
                  <th className="py-2 font-medium">How</th>
                  <th className="py-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {consents.data.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4 text-slate">{formatDateTime(r.capturedAt)}</td>
                    <td className="py-2 pr-4 text-slate">
                      {r.purpose === 'MARKETING' ? 'Marketing' : 'Utility'}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge tone={CONSENT_TONE[r.status]}>{CONSENT_LABEL[r.status]}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-slate">{SOURCE_TEXT[r.source] ?? r.source}</td>
                    <td className="py-2 text-sm text-muted">
                      {[
                        r.evidence.note ? `“${String(r.evidence.note)}”` : null,
                        r.evidence.keyword ? `Replied "${String(r.evidence.keyword)}"` : null,
                        r.evidence.messageId
                          ? `Message ${String(r.evidence.messageId).slice(0, 8)}…`
                          : null,
                        r.evidence.importJobId ? `Import row ${String(r.evidence.row)}` : null,
                        r.evidence.errorCode ? String(r.evidence.errorCode) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="No consent recorded"
              description="This contact hasn't opted in or out yet."
            />
          )}
        </TabsContent>

        <TabsContent value="notes" className="flex flex-col gap-4">
          {canWrite ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                addNote.mutate()
              }}
            >
              <label htmlFor="new-note" className="text-sm font-medium text-slate">
                Add a note
              </label>
              <textarea
                id="new-note"
                className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-base text-slate"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                maxLength={5000}
              />
              <Button type="submit" className="self-start" loading={addNote.isPending}>
                Save note
              </Button>
            </form>
          ) : null}
          {notes.data?.length ? (
            <ul className="flex flex-col gap-3">
              {notes.data.map((n) => (
                <li key={n.id} className="rounded-md border border-border bg-surface p-3">
                  <p className="whitespace-pre-wrap text-slate">{n.body}</p>
                  <p className="mt-1 text-sm text-muted">
                    {n.authorName} · {formatDateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Alert tone="info">No notes yet.</Alert>
          )}
        </TabsContent>
      </Tabs>

      <ContactFormModal
        open={editing}
        onOpenChange={setEditing}
        contact={c}
        onSaved={() => {
          toast.success('Contact saved')
          refresh()
        }}
      />
      <ConsentModal
        contact={c}
        open={consentOpen}
        onOpenChange={setConsentOpen}
        onSaved={refresh}
      />
    </div>
  )
}
