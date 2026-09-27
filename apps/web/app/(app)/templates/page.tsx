'use client'

import { TEMPLATE_CATEGORIES, TEMPLATE_STATUSES, type Template } from '@fenwira/contracts'
import {
  Alert,
  Button,
  type ColumnDef,
  DataTable,
  FilterBar,
  ListPage,
  PermissionState,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useDebounced } from '@/components/inbox/conversation-list'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post } from '@/lib/api/client'
import { relativeTime } from '@/lib/relative-time'
import { CATEGORY_LABEL, languageLabel, templatesKey, useTemplates } from '@/lib/templates'

const ALL = 'ALL'

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`Any ${label.toLowerCase()}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Templates list (docs/TEMPLATE_ENGINE.md): filters, status, sync from Meta. */
export default function TemplatesPage() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(ALL)
  const [category, setCategory] = useState(ALL)
  const search = useDebounced(q.trim())
  const params = new URLSearchParams({
    ...(search ? { q: search } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(category !== ALL ? { category } : {}),
  })
  const templates = useTemplates(params)
  const sync = useMutation({
    mutationFn: () =>
      post<{ data: Array<{ imported: number; updated: number }> }>('/templates/sync', {}),
    onSuccess: (r) => {
      const imported = r.data.reduce((n, x) => n + x.imported, 0)
      const updated = r.data.reduce((n, x) => n + x.updated, 0)
      toast.success(`Synced from Meta: ${imported} new, ${updated} updated`)
      void queryClient.invalidateQueries({ queryKey: templatesKey(tenantId) })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'The sync failed.'),
  })
  if (!can('templates.read')) return <PermissionState what="templates" />

  const columns: Array<ColumnDef<Template>> = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link
          href={`/templates/${row.original.id}`}
          className="font-medium text-slate underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    { id: 'language', header: 'Language', cell: ({ row }) => languageLabel(row.original.language) },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => CATEGORY_LABEL[row.original.category],
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const t = row.original
        const reason = t.currentVersion.rejectionReason ?? t.currentVersion.lastError
        return (
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={t.status} />
              {t.qualityScore && t.qualityScore !== 'UNKNOWN' ? (
                <StatusBadge status={t.qualityScore as 'GREEN' | 'YELLOW' | 'RED'} />
              ) : null}
            </span>
            {t.status === 'REJECTED' && reason ? (
              <span className="max-w-xs text-sm text-secondary">Meta: {reason}</span>
            ) : null}
          </div>
        )
      },
    },
    { id: 'account', header: 'Account', cell: ({ row }) => row.original.wabaName },
    {
      id: 'updated',
      header: 'Last updated',
      cell: ({ row }) => relativeTime(row.original.updatedAt),
    },
  ]

  const filtered = !!(search || status !== ALL || category !== ALL)
  const rejected = (templates.data ?? []).filter((t) => t.status === 'REJECTED').length

  return (
    <ListPage
      header={{
        title: 'Templates',
        description:
          'Messages Meta approves in advance, so you can start conversations and send updates.',
        actions: can('templates.write') ? (
          <>
            <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
              <RefreshCw aria-hidden="true" />
              Sync from Meta
            </Button>
            <Button asChild>
              <Link href="/templates/new">
                <Plus aria-hidden="true" />
                New template
              </Link>
            </Button>
          </>
        ) : null,
      }}
      banner={
        rejected && status !== 'REJECTED' ? (
          <Alert
            tone="danger"
            title={`${rejected} template${rejected > 1 ? 's were' : ' was'} rejected by Meta`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setStatus('REJECTED')}>
                Show rejected
              </Button>
            }
          >
            Open a template to see Meta’s reason, edit it and submit it again.
          </Alert>
        ) : undefined
      }
    >
      <DataTable
        label="Templates"
        columns={columns}
        data={templates.data ?? []}
        getRowId={(t) => t.id}
        loading={templates.isPending}
        error={
          templates.isError
            ? {
                message: templates.error instanceof ApiError ? templates.error.message : undefined,
                onRetry: () => void templates.refetch(),
              }
            : undefined
        }
        toolbar={
          <FilterBar
            activeCount={(search ? 1 : 0) + (status !== ALL ? 1 : 0) + (category !== ALL ? 1 : 0)}
            onClear={() => {
              setQ('')
              setStatus(ALL)
              setCategory(ALL)
            }}
          >
            <SearchInput
              label="Search templates"
              placeholder="Template name"
              value={q}
              onValueChange={setQ}
            />
            <Filter
              label="Status"
              value={status}
              onChange={setStatus}
              options={TEMPLATE_STATUSES.filter((s) => s !== 'ARCHIVED').map((s) => ({
                value: s,
                label: s.charAt(0) + s.slice(1).toLowerCase(),
              }))}
            />
            <Filter
              label="Category"
              value={category}
              onChange={setCategory}
              options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            />
          </FilterBar>
        }
        empty={
          filtered
            ? { title: 'No matches', description: 'Try another name, status or category.' }
            : {
                title: 'No templates yet',
                description:
                  'Templates are the only way to start a conversation or message someone after 24 hours. Create one for Meta to review, or sync the ones you already have in WhatsApp Manager.',
                action: can('templates.write') ? (
                  <Button asChild>
                    <Link href="/templates/new">
                      <Plus aria-hidden="true" />
                      Create your first template
                    </Link>
                  </Button>
                ) : undefined,
              }
        }
      />
    </ListPage>
  )
}
