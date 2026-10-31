'use client'

import { type ContactFilter, EMPTY_FILTER, type Segment } from '@fenwira/contracts'
import {
  Button,
  type ColumnDef,
  DataTable,
  Field,
  Input,
  ListPage,
  Modal,
  ModalClose,
  ModalContent,
  PermissionState,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { completeFilter, FilterBuilder } from '@/components/contacts/filter-builder'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useSegments } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'

/** Debounced value (the live count re-queries as the filter is edited). */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function SegmentEditor({
  segment,
  open,
  onOpenChange,
}: {
  segment: Segment | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<ContactFilter>(EMPTY_FILTER)
  useEffect(() => {
    if (!open) return
    setName(segment?.name ?? '')
    setDraft(segment?.filter ?? EMPTY_FILTER)
  }, [open, segment])
  const filter = useDebounced(useMemo(() => completeFilter(draft), [draft]))
  const count = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts-count', JSON.stringify({ filter })),
    queryFn: () =>
      post<{ data: { count: number } }>('/contacts/count', { filter }).then((r) => r.data.count),
    placeholderData: keepPreviousData,
    enabled: open,
  })
  const save = useMutation({
    mutationFn: () =>
      segment
        ? patch(`/segments/${segment.id}`, { name, filter: completeFilter(draft) })
        : post('/segments', { name, filter: completeFilter(draft) }),
    onSuccess: () => {
      toast.success(segment ? 'Segment saved' : 'Segment created')
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'segments') })
      onOpenChange(false)
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={segment ? 'Edit segment' : 'New segment'}
        description="A segment is a saved filter; membership updates as contacts change."
        className="max-w-3xl"
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="segment-editor" loading={save.isPending}>
              Save segment
            </Button>
          </>
        }
      >
        <form
          id="segment-editor"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <FilterBuilder value={draft} onChange={setDraft} />
          <p className="text-base text-fg" aria-live="polite">
            {count.isError
              ? count.error instanceof ApiError
                ? count.error.message
                : 'Could not count contacts.'
              : count.data === undefined
                ? 'Counting…'
                : `${count.data.toLocaleString()} contacts match right now`}
          </p>
        </form>
      </ModalContent>
    </Modal>
  )
}

export default function SegmentsPage() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const segments = useSegments()
  const [editing, setEditing] = useState<Segment | null>(null)
  const [open, setOpen] = useState(false)
  const recount = useMutation({
    mutationFn: (id: string) => post(`/segments/${id}/count`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'segments') }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/segments/${id}`),
    onSuccess: () => {
      toast.success('Segment deleted')
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'segments') })
    },
  })

  if (!can('contacts.read')) return <PermissionState what="segments" />
  const canWrite = can('contacts.write')
  const columns: ColumnDef<Segment, unknown>[] = [
    { accessorKey: 'name', header: 'Segment' },
    {
      id: 'count',
      header: 'Contacts',
      cell: ({ row }) =>
        row.original.cachedCount === null ? (
          '—'
        ) : (
          <span title={row.original.cachedCountAt ?? undefined}>
            ≈ {row.original.cachedCount.toLocaleString()}
            {row.original.cachedCountAt ? (
              <span className="ml-1 text-sm text-fg-muted">
                ({relativeTime(row.original.cachedCountAt)})
              </span>
            ) : null}
          </span>
        ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => recount.mutate(row.original.id)}>
            Recount
          </Button>
          {canWrite ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(row.original)
                  setOpen(true)
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete "${row.original.name}"?`,
                      description: 'Contacts are not affected.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    })
                  )
                    remove.mutate(row.original.id)
                }}
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <ListPage
      header={{
        title: 'Segments',
        description: 'Saved groups of contacts, used for campaigns and exports.',
        actions: canWrite ? (
          <Button
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <Plus aria-hidden="true" />
            New segment
          </Button>
        ) : null,
      }}
    >
      <DataTable
        label="Segments"
        columns={columns}
        data={segments.data ?? []}
        getRowId={(s) => s.id}
        loading={segments.isPending}
        empty={{
          title: 'No segments yet',
          description: 'Build one from a filter to target groups of contacts.',
        }}
      />
      <SegmentEditor segment={editing} open={open} onOpenChange={setOpen} />
    </ListPage>
  )
}
