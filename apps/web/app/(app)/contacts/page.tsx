'use client'

import { type Contact, type ContactFilter, EMPTY_FILTER, type ExportJob } from '@fenwira/contracts'
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  Field,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  PageHeader,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Filter, Plus, Tags } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useMemo, useState } from 'react'
import { ContactFormModal } from '@/components/contacts/contact-form-modal'
import { completeFilter, countRules, FilterBuilder } from '@/components/contacts/filter-builder'
import { TagBadges } from '@/components/contacts/tag-badges'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { ApiError, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { CONSENT_LABEL, CONSENT_TONE, SOURCE_LABEL, useTags } from '@/lib/contacts'
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

export default function ContactsPage() {
  const { tenantId, can } = useSession()
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

  if (!can('contacts.read')) return <NoAccess what="contacts" />

  const columns: ColumnDef<Contact, unknown>[] = [
    {
      id: 'name',
      header: 'Contact',
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/contacts/${row.original.id}`}
            className="font-medium text-slate underline-offset-4 hover:underline"
          >
            {row.original.name ?? row.original.waProfileName ?? 'Unnamed'}
          </Link>
          <span className="font-mono text-sm text-muted">{row.original.phoneE164}</span>
        </div>
      ),
    },
    { id: 'tags', header: 'Tags', cell: ({ row }) => <TagBadges tags={row.original.tags} /> },
    {
      id: 'consent',
      header: 'Marketing',
      cell: ({ row }) => (
        <Badge tone={CONSENT_TONE[row.original.marketingConsent]}>
          {CONSENT_LABEL[row.original.marketingConsent]}
        </Badge>
      ),
    },
    { id: 'source', header: 'Source', cell: ({ row }) => SOURCE_LABEL[row.original.source] },
    {
      id: 'lastInbound',
      header: 'Last message',
      cell: ({ row }) =>
        row.original.lastInboundAt ? relativeTime(row.original.lastInboundAt) : '—',
    },
  ]
  const rules = countRules(filter)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description={
          count.data !== undefined
            ? `${count.data.toLocaleString()} contacts match`
            : 'Everyone you message on WhatsApp.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
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
                New contact
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            className="max-w-sm"
            placeholder="Search name, phone or email"
            aria-label="Search contacts"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursors([])
            }}
          />
          <Button
            variant="secondary"
            aria-expanded={showFilter}
            onClick={() => setShowFilter((s) => !s)}
          >
            <Filter aria-hidden="true" />
            {rules ? `Filters (${rules})` : 'Filter'}
          </Button>
          {rules && can('contacts.write') ? (
            <Button variant="ghost" onClick={() => setSaving(true)}>
              Save as segment
            </Button>
          ) : null}
          {selected.length && can('contacts.write') ? (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" className="ml-auto">
                  <Tags aria-hidden="true" />
                  {selected.length} selected
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>Add tag</DropdownLabel>
                {tags.map((t) => (
                  <DropdownItem
                    key={`add-${t.id}`}
                    onSelect={() => bulk.mutate({ action: 'TAG', tagId: t.id })}
                  >
                    {t.name}
                  </DropdownItem>
                ))}
                <DropdownSeparator />
                <DropdownLabel>Remove tag</DropdownLabel>
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
                            description:
                              'They disappear from lists and segments. Their message history is kept.',
                            confirmLabel: 'Delete',
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
          ) : null}
        </div>
        {showFilter ? (
          <div className="rounded-lg border border-border bg-surface p-3">
            <FilterBuilder
              value={draft}
              onChange={(f) => {
                setDraft(f)
                setCursors([])
              }}
            />
          </div>
        ) : null}
      </div>
      <DataTable
        label="Contacts"
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(c) => c.id}
        selectable={can('contacts.write')}
        onSelectionChange={setSelected}
        loading={list.isPending}
        error={
          list.isError
            ? { message: message(list.error), onRetry: () => void list.refetch() }
            : undefined
        }
        empty={{
          title: rules || q ? 'No contacts match' : 'No contacts yet',
          description:
            rules || q
              ? 'Try a different search or filter.'
              : 'Contacts appear when customers message you, or add and import them.',
        }}
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
    </div>
  )
}
