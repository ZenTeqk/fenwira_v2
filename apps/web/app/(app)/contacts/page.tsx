'use client'

import { type Contact, type ContactFilter, EMPTY_FILTER, type ExportJob } from '@fenwira/contracts'
import { EligibilityIndicator } from '@/components/contacts/eligibility-summary'
import {
  Button,
  Avatar,
  type ColumnDef,
  DataTable,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  Field,
  FilterBar,
  Input,
  ListPage,
  Modal,
  ModalClose,
  ModalContent,
  PermissionState,
  RowActions,
  SearchInput,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Eye, Filter, Plus, Tags, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContactFormModal } from '@/components/contacts/contact-form-modal'
import { ContactPreview } from '@/components/contacts/contact-preview'
import { completeFilter, countRules, FilterBuilder } from '@/components/contacts/filter-builder'
import { TagBadges } from '@/components/contacts/tag-badges'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useTags } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'

const PAGE = 50
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong.')

function SaveSegmentModal({
  filter,
  open,
  onOpenChange,
}: {
  filter: ContactFilter
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => post('/segments', { name, filter }),
    onSuccess: () => {
      toast.success(`Segment "${name}" saved`)
      setName('')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'segments') })
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Save as segment"
        description="Segments update automatically as contacts change."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="segment-form" loading={save.isPending}>
              Save segment
            </Button>
          </>
        }
      >
        <form
          id="segment-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field
            label="Segment name"
            error={save.error instanceof ApiError ? save.error.message : undefined}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoFocus
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}

function Contacts() {
  const { tenantId, can, me } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const tags = useTags().data ?? []
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<ContactFilter>(EMPTY_FILTER)
  const [showFilter, setShowFilter] = useState(false)
  const [cursors, setCursors] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const previewTrigger = useRef<HTMLElement | null>(null)
  const openPreview = useCallback((id: string) => {
    const active = document.activeElement as HTMLElement
    previewTrigger.current = active.closest('[role="menu"]')
      ? document.querySelector<HTMLElement>(`[data-contact-actions="${id}"] button`)
      : active
    setPreview(id)
  }, [])
  const params = useSearchParams()
  // The command palette's "New contact" opens the form here (/contacts?new=1).
  useEffect(() => {
    if (params.get('new') === '1' && can('contacts.write')) {
      setCreating(true)
      router.replace('/contacts')
    }
  }, [params, can, router])
  const filter = useMemo(() => completeFilter(draft), [draft])
  const cursor = cursors[cursors.length - 1]
  const body = { filter, q: q.trim() || undefined }

  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', JSON.stringify(body), cursor ?? ''),
    queryFn: () =>
      post<{ data: Contact[]; page: { nextCursor: string | null } }>('/contacts/search', {
        ...body,
        limit: PAGE,
        cursor,
      }),
    placeholderData: keepPreviousData,
    enabled: can('contacts.read'),
  })
  const count = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts-count', JSON.stringify(body)),
    queryFn: () =>
      post<{ data: { count: number } }>('/contacts/count', body).then((r) => r.data.count),
    placeholderData: keepPreviousData,
    enabled: can('contacts.read'),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts') })
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts-count') })
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'tags') })
  }
  const bulk = useMutation({
    mutationFn: (req: { action: 'TAG' | 'UNTAG' | 'DELETE'; tagId?: string }) =>
      post<{ data: { affected: number } }>('/contacts/bulk', { ...req, contactIds: selected }),
    onSuccess: (res, req) => {
      toast.success(
        req.action === 'DELETE'
          ? `Deleted ${res.data.affected} contacts`
          : `Updated ${res.data.affected} contacts`,
      )
      refresh()
    },
    onError: (err) => toast.error(message(err)),
  })
  const exportCsv = useMutation({
    mutationFn: async () => {
      const job = (await post<{ data: ExportJob }>('/exports', body)).data
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const cur = (await get<{ data: ExportJob }>(`/exports/${job.id}`)).data
        if (cur.status === 'COMPLETED' && cur.downloadUrl) return cur
        if (cur.status === 'FAILED') throw new Error('The export failed.')
      }
      throw new Error('The export is taking longer than expected. Try again in a minute.')
    },
    onSuccess: (job) => {
      toast.success(`Export ready: ${job.rowCount} contacts`)
      window.location.assign(job.downloadUrl!)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The export failed.'),
  })

  if (!can('contacts.read')) return <PermissionState what="contacts" />

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              name={row.original.name ?? row.original.waProfileName ?? row.original.phoneE164}
              size="md"
            />
            <Button
              variant="ghost"
              className="h-auto min-h-9 justify-start px-0 font-medium"
              onClick={() => openPreview(row.original.id)}
            >
              {row.original.name ?? row.original.waProfileName ?? 'Unnamed contact'}
            </Button>
          </div>
        ),
      },
      {
        id: 'phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-secondary">{row.original.phoneE164}</span>
        ),
      },
      {
        id: 'tags',
        header: 'Tags',
        meta: { label: 'Tags' },
        cell: ({ row }) => <TagBadges tags={row.original.tags} />,
      },
      {
        id: 'eligibility',
        header: 'WhatsApp eligibility',
        cell: ({ row }) => <EligibilityIndicator contactId={row.original.id} />,
      },
      {
        id: 'lastInbound',
        header: 'Last incoming message',
        cell: ({ row }) =>
          row.original.lastInboundAt ? relativeTime(row.original.lastInboundAt) : '—',
      },
      {
        id: 'assigned',
        header: 'Assigned',
        cell: ({ row }) =>
          row.original.ownerId ? (
            row.original.ownerId === me.user.id ? (
              'You'
            ) : (
              'Assigned teammate'
            )
          ) : (
            <span className="text-muted">Unassigned</span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <span data-contact-actions={row.original.id}>
            <RowActions
              label={`Actions for ${row.original.name ?? row.original.phoneE164}`}
              actions={[
                {
                  label: 'Quick view',
                  icon: <Eye aria-hidden="true" />,
                  onSelect: () => openPreview(row.original.id),
                },
                {
                  label: 'Open contact',
                  icon: <ExternalLink aria-hidden="true" />,
                  onSelect: () => router.push(`/contacts/${row.original.id}`),
                },
              ]}
            />
          </span>
        ),
      },
    ],
    [me.user.id, openPreview, router],
  )
  const rules = countRules(filter)
  const filtered = !!(rules || q.trim())

  return (
    <ListPage
      header={{
        title: 'Contacts',
        description: 'People your team communicates with on WhatsApp.',
        actions: (
          <>
            {can('contacts.import') ? (
              <Button variant="secondary" asChild>
                <Link href="/contacts/imports">
                  <Upload aria-hidden="true" />
                  Import
                </Link>
              </Button>
            ) : null}
            {can('contacts.export') ? (
              <Button
                variant="secondary"
                loading={exportCsv.isPending}
                onClick={() => exportCsv.mutate()}
              >
                <Download aria-hidden="true" />
                Export
              </Button>
            ) : null}
            {can('contacts.write') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                Add contact
              </Button>
            ) : null}
          </>
        ),
      }}
    >
      <p role="status" className="text-sm text-secondary">
        {count.data !== undefined
          ? `${count.data.toLocaleString('en-IN')} contacts${filtered ? ' match' : ''}`
          : count.isError
            ? 'Contact count unavailable'
            : 'Loading contact count…'}
      </p>
      <DataTable
        label="Contacts"
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(c) => c.id}
        selectable={can('contacts.write')}
        onSelectionChange={setSelected}
        columnVisibility
        toolbar={
          <FilterBar
            activeCount={rules + (q.trim() ? 1 : 0)}
            onClear={() => {
              setQ('')
              setDraft(EMPTY_FILTER)
              setCursors([])
            }}
          >
            <SearchInput
              label="Search contacts"
              placeholder="Search name, phone or email"
              value={q}
              onValueChange={(v) => {
                setQ(v)
                setCursors([])
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={showFilter}
              onClick={() => setShowFilter((s) => !s)}
            >
              <Filter aria-hidden="true" />
              {rules ? `Filters (${rules})` : 'Filter'}
            </Button>
            {rules && can('contacts.write') ? (
              <Button variant="ghost" size="sm" onClick={() => setSaving(true)}>
                Save as segment
              </Button>
            ) : null}
            {showFilter ? (
              <div className="w-full rounded-lg border border-border bg-surface p-3">
                <FilterBuilder
                  value={draft}
                  onChange={(f) => {
                    setDraft(f)
                    setCursors([])
                  }}
                />
              </div>
            ) : null}
          </FilterBar>
        }
        bulkActions={
          can('contacts.write')
            ? () => (
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <Tags aria-hidden="true" />
                      Tags
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent align="start">
                    {tags.length ? null : (
                      <DropdownLabel>Create tags in Contacts → Tags first</DropdownLabel>
                    )}
                    {tags.length ? <DropdownLabel>Add tag</DropdownLabel> : null}
                    {tags.map((t) => (
                      <DropdownItem
                        key={`add-${t.id}`}
                        onSelect={() => bulk.mutate({ action: 'TAG', tagId: t.id })}
                      >
                        {t.name}
                      </DropdownItem>
                    ))}
                    {tags.length ? <DropdownSeparator /> : null}
                    {tags.length ? <DropdownLabel>Remove tag</DropdownLabel> : null}
                    {tags.map((t) => (
                      <DropdownItem
                        key={`rm-${t.id}`}
                        onSelect={() => bulk.mutate({ action: 'UNTAG', tagId: t.id })}
                      >
                        {t.name}
                      </DropdownItem>
                    ))}
                    {can('contacts.delete') ? (
                      <>
                        <DropdownSeparator />
                        <DropdownItem
                          destructive
                          onSelect={async () => {
                            if (
                              await confirm({
                                title: `Delete ${selected.length} contacts?`,
                                description: 'This can’t be undone from the app.',
                                impact: [
                                  'They disappear from lists, segments and future campaigns.',
                                  'Their message history is kept for your records.',
                                ],
                                confirmLabel: 'Delete contacts',
                                destructive: true,
                              })
                            )
                              bulk.mutate({ action: 'DELETE' })
                          }}
                        >
                          Delete
                        </DropdownItem>
                      </>
                    ) : null}
                  </DropdownContent>
                </Dropdown>
              )
            : undefined
        }
        loading={list.isPending}
        error={
          list.isError
            ? { message: message(list.error), onRetry: () => void list.refetch() }
            : undefined
        }
        empty={
          filtered
            ? {
                title: 'No contacts match',
                description: 'Try a different search, or clear the filters.',
              }
            : {
                title: 'No contacts yet',
                description:
                  'Contacts are the people you message on WhatsApp. They appear when customers write to you; you can also add them or import a CSV, with their consent.',
                action: can('contacts.write') ? (
                  <div className="flex gap-2">
                    <Button onClick={() => setCreating(true)}>
                      <Plus aria-hidden="true" />
                      Add your first contact
                    </Button>
                    {can('contacts.import') ? (
                      <Button variant="secondary" asChild>
                        <Link href="/contacts/imports">Import CSV</Link>
                      </Button>
                    ) : null}
                  </div>
                ) : undefined,
              }
        }
        pagination={{
          hasPrevious: cursors.length > 0,
          hasNext: !!list.data?.page.nextCursor,
          onPrevious: () => setCursors((c) => c.slice(0, -1)),
          onNext: () =>
            list.data?.page.nextCursor && setCursors((c) => [...c, list.data!.page.nextCursor!]),
          summary: `Page ${cursors.length + 1}`,
        }}
      />
      <ContactFormModal
        open={creating}
        onOpenChange={setCreating}
        onSaved={(c) => {
          toast.success('Contact created')
          refresh()
          router.push(`/contacts/${c.id}`)
        }}
      />
      <SaveSegmentModal filter={filter} open={saving} onOpenChange={setSaving} />
      <ContactPreview
        id={preview}
        onClose={() => setPreview(null)}
        restoreFocus={() => previewTrigger.current?.focus()}
      />
    </ListPage>
  )
}

export default function ContactsPage() {
  return (
    <Suspense>
      <Contacts />
    </Suspense>
  )
}
