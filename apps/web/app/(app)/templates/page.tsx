'use client'

import { TEMPLATE_CATEGORIES, TEMPLATE_STATUSES, type Template } from '@fenwira/contracts'
import {
  Button,
  type ColumnDef,
  DataTable,
  Input,
  PageHeader,
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
import { useId, useState } from 'react'
import { useDebounced } from '@/components/inbox/conversation-list'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
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
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-sm font-medium text-slate">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
  if (!can('templates.read')) return <NoAccess what="templates" />

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
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.original.status} />
          {row.original.qualityScore && row.original.qualityScore !== 'UNKNOWN' ? (
            <StatusBadge status={row.original.qualityScore as 'GREEN' | 'YELLOW' | 'RED'} />
          ) : null}
        </span>
      ),
    },
    { id: 'account', header: 'Account', cell: ({ row }) => row.original.wabaName },
    {
      id: 'updated',
      header: 'Last updated',
      cell: ({ row }) => relativeTime(row.original.updatedAt),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Templates"
        description="Messages Meta approves in advance, so you can start conversations and send updates."
        actions={
          can('templates.write') ? (
            <div className="flex flex-wrap gap-2">
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
            </div>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="template-search" className="text-sm font-medium text-slate">
            Search
          </label>
          <Input
            id="template-search"
            type="search"
            placeholder="Template name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-60"
          />
        </div>
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
      </div>
      <DataTable
        label="Templates"
        columns={columns}
        data={templates.data ?? []}
        getRowId={(t) => t.id}
        loading={templates.isPending}
        empty={{
          title: search || status !== ALL || category !== ALL ? 'No matches' : 'No templates yet',
          description: can('templates.write')
            ? 'Create one, or sync the templates you already have in WhatsApp Manager.'
            : 'Templates your team creates appear here.',
        }}
      />
    </div>
  )
}
