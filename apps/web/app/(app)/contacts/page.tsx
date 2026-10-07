'use client'

import {
  type Contact,
  type ContactFilter,
  type FilterRule,
  isFilterGroup,
  EMPTY_FILTER,
  type ExportJob,
} from '@fenwira/contracts'
import { ContactDirectory } from '@/components/contacts/contact-directory'
import {
  Button,
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
  ModuleTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Modal,
  ModalClose,
  ModalContent,
  PermissionState,
  SearchInput,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter, Plus, Tags, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContactFormModal } from '@/components/contacts/contact-form-modal'
import { ContactPreview } from '@/components/contacts/contact-preview'
import { completeFilter, countRules, FilterBuilder } from '@/components/contacts/filter-builder'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useTags } from '@/lib/contacts'

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
  const previewTriggerId = useRef<string | null>(null)
  const openPreview = useCallback((id: string) => {
    previewTriggerId.current = id
    const active = document.activeElement as HTMLElement
    previewTrigger.current = active.closest('[role="menu"]')
      ? ([...document.querySelectorAll<HTMLElement>(`[data-contact-actions="${id}"] button`)].find(
          (button) => button.getClientRects().length > 0,
        ) ?? null)
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
  // Quick controls edit the same root DSL rules as the advanced builder, preserving its op/depth.
  const tagRule = draft.rules.find(
    (r): r is FilterRule =>
      !isFilterGroup(r) &&
      r.field === 'tags' &&
      r.operator === 'HAS_ANY' &&
      Array.isArray(r.value) &&
      r.value.length === 1,
  )
  const ownerRule = draft.rules.find(
    (r): r is FilterRule => !isFilterGroup(r) && r.field === 'ownerId',
  )
  const tagFilter = tagRule ? (tagRule.value as string[])[0]! : '__all'
  const ownerFilter =
    ownerRule?.operator === 'NOT_EXISTS'
      ? 'unassigned'
      : ownerRule?.operator === 'IN' &&
          Array.isArray(ownerRule.value) &&
          ownerRule.value.length === 1 &&
          ownerRule.value[0] === me.user.id
        ? 'mine'
        : '__all'
  const quickRule = (field: string, rule: FilterRule | null) => {
    setDraft((current) => ({
      ...current,
      rules: [
        ...current.rules.filter((r) => isFilterGroup(r) || r.field !== field),
        ...(rule ? [rule] : []),
      ],
    }))
    setCursors([])
  }
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

  const rules = countRules(filter)
  const filtered = !!(rules || q.trim())

  return (
    <div className="flex min-w-0 items-start gap-4">
      <ListPage
        className="min-w-0 flex-1 gap-4"
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
        <ModuleTabs
          label="Contacts pages"
          linkAs={Link}
          className="border-0 bg-transparent [&_ul]:px-0 [&_a]:h-10 [&_a]:text-sm"
          items={[
            { id: 'all', label: 'All contacts', href: '/contacts', active: true },
            { id: 'segments', label: 'Segments', href: '/contacts/segments', active: false },
            { id: 'tags', label: 'Tags', href: '/contacts/tags', active: false },
            ...(can('contacts.import')
              ? [{ id: 'imports', label: 'Imports', href: '/contacts/imports', active: false }]
              : []),
          ]}
        />
        <ContactDirectory
          data={list.data?.data ?? []}
          preview={preview}
          onPreview={openPreview}
          selected={selected}
          selectable={can('contacts.write')}
          onSelectionChange={setSelected}
          onExport={can('contacts.export') ? () => exportCsv.mutate() : undefined}
          exporting={exportCsv.isPending}
          toolbar={(columns) => (
            <FilterBar
              end={columns}
              activeCount={rules + (q.trim() ? 1 : 0)}
              onClear={() => {
                setQ('')
                setDraft(EMPTY_FILTER)
                setCursors([])
              }}
            >
              <SearchInput
                label="Search contacts"
                placeholder="Search contacts…"
                className="w-full sm:w-52"
                value={q}
                onValueChange={(v) => {
                  setQ(v)
                  setCursors([])
                }}
              />
              <Select
                value={tagFilter}
                onValueChange={(v) => {
                  quickRule(
                    'tags',
                    v === '__all' ? null : { field: 'tags', operator: 'HAS_ANY', value: [v] },
                  )
                }}
              >
                <SelectTrigger aria-label="Filter by tag" className="h-10 w-28 sm:h-9">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All tags</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={ownerFilter}
                onValueChange={(v) => {
                  quickRule(
                    'ownerId',
                    v === '__all'
                      ? null
                      : v === 'mine'
                        ? { field: 'ownerId', operator: 'IN', value: [me.user.id] }
                        : { field: 'ownerId', operator: 'NOT_EXISTS' },
                  )
                }}
              >
                <SelectTrigger
                  aria-label="Filter by assignment"
                  className="h-10 w-36 whitespace-nowrap sm:h-9"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Assignment</SelectItem>
                  <SelectItem value="mine">Assigned to me</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                className="min-h-10 sm:min-h-8"
                aria-expanded={showFilter}
                onClick={() => setShowFilter((s) => !s)}
              >
                <Filter aria-hidden="true" />
                {rules ? `More filters (${rules})` : 'More filters'}
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
          )}
          bulkActions={
            can('contacts.write') ? (
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button variant="secondary" size="sm" disabled={bulk.isPending}>
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
            ) : undefined
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
            summary: (
              <span role="status">
                {count.data !== undefined
                  ? `${count.data.toLocaleString('en-IN')} contacts${filtered ? ' match' : ''}`
                  : count.isError
                    ? 'Contact count unavailable'
                    : 'Loading contact count…'}{' '}
                · Page {cursors.length + 1}
              </span>
            ),
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
      </ListPage>
      <ContactPreview
        id={preview}
        onClose={() => setPreview(null)}
        restoreFocus={() => {
          const original = previewTrigger.current
          if (original?.getClientRects().length) original.focus()
          else
            [
              ...document.querySelectorAll<HTMLElement>(
                `[data-contact-preview="${previewTriggerId.current}"]`,
              ),
            ]
              .find((button) => button.getClientRects().length > 0)
              ?.focus()
        }}
      />
    </div>
  )
}

export default function ContactsPage() {
  return (
    <Suspense>
      <Contacts />
    </Suspense>
  )
}
