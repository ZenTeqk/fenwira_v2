'use client'

import { TAG_COLORS, type TagColor } from '@fenwira/contracts'
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Field,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { del, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { TAG_TONE, useTags } from '@/lib/contacts'

type TagRow = { id: string; name: string; color: TagColor; contactCount: number }
const COLOR_LABEL: Record<TagColor, string> = {
  NEUTRAL: 'Gray',
  PRIMARY: 'Green',
  INFO: 'Indigo',
  WARNING: 'Amber',
  DANGER: 'Red',
  SUCCESS: 'Teal',
}

function TagModal({
  tag,
  open,
  onOpenChange,
}: {
  tag: TagRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState<TagColor>('NEUTRAL')
  useEffect(() => {
    if (!open) return
    setName(tag?.name ?? '')
    setColor(tag?.color ?? 'NEUTRAL')
  }, [open, tag])
  const save = useMutation({
    mutationFn: () =>
      tag ? patch(`/tags/${tag.id}`, { name, color }) : post('/tags', { name, color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'tags') })
      onOpenChange(false)
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={tag ? 'Edit tag' : 'New tag'}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="tag-form" loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form
          id="tag-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={40}
              autoFocus
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id="tag-color" className="text-sm font-medium text-slate">
              Color
            </span>
            <Select value={color} onValueChange={(v) => setColor(v as TagColor)}>
              <SelectTrigger aria-labelledby="tag-color">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAG_COLORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {COLOR_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge tone={TAG_TONE[color]} className="self-start">
            {name || 'Preview'}
          </Badge>
        </form>
      </ModalContent>
    </Modal>
  )
}

export default function TagsPage() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const tags = useTags()
  const [editing, setEditing] = useState<TagRow | null>(null)
  const [open, setOpen] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tags/${id}`),
    onSuccess: () => {
      toast.success('Tag deleted')
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'tags') })
    },
  })
  if (!can('contacts.read')) return <NoAccess what="tags" />
  const canWrite = can('contacts.write')
  const columns: ColumnDef<TagRow, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Tag',
      cell: ({ row }) => <Badge tone={TAG_TONE[row.original.color]}>{row.original.name}</Badge>,
    },
    {
      accessorKey: 'contactCount',
      header: 'Contacts',
      cell: ({ row }) => row.original.contactCount.toLocaleString(),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        canWrite ? (
          <div className="flex justify-end gap-2">
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
                    description: `It is removed from ${row.original.contactCount} contacts.`,
                    confirmLabel: 'Delete',
                    destructive: true,
                  })
                )
                  remove.mutate(row.original.id)
              }}
            >
              Delete
            </Button>
          </div>
        ) : null,
    },
  ]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tags"
        description="Labels for grouping contacts."
        actions={
          canWrite ? (
            <Button
              onClick={() => {
                setEditing(null)
                setOpen(true)
              }}
            >
              <Plus aria-hidden="true" />
              New tag
            </Button>
          ) : null
        }
      />
      <DataTable
        label="Tags"
        columns={columns}
        data={tags.data ?? []}
        getRowId={(t) => t.id}
        loading={tags.isPending}
        empty={{ title: 'No tags yet', description: 'Tags created by imports appear here too.' }}
      />
      <TagModal tag={editing} open={open} onOpenChange={setOpen} />
    </div>
  )
}
