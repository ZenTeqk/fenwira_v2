'use client'

import { type AuditLog, type Page } from '@fenwira/contracts'
import { type ColumnDef, DataTable, Input, Label, ListPage, PermissionState } from '@fenwira/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'Created the workspace',
  'workspace.updated': 'Updated workspace settings',
  'workspace.deleted': 'Deleted the workspace',
  'workspace.ownership_transferred': 'Transferred ownership',
  'team.invitation.sent': 'Invited a teammate',
  'team.invitation.resent': 'Resent an invitation',
  'team.invitation.revoked': 'Revoked an invitation',
  'team.invitation.accepted': 'Accepted an invitation',
  'team.member.role_changed': 'Changed a member’s role',
  'team.member.deactivated': 'Deactivated a member',
  'team.member.reactivated': 'Reactivated a member',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const columns: ColumnDef<AuditLog, unknown>[] = [
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {dateFormat.format(new Date(row.original.createdAt))}
      </span>
    ),
  },
  {
    accessorKey: 'actorName',
    header: 'Who',
    cell: ({ row }) =>
      row.original.actorName ?? (row.original.actorType === 'SYSTEM' ? 'System' : 'Unknown'),
  },
  {
    accessorKey: 'action',
    header: 'What',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-fg">{ACTION_LABELS[row.original.action] ?? row.original.action}</span>
        <span className="font-mono text-xs text-fg-muted">{row.original.action}</span>
      </div>
    ),
  },
  {
    accessorKey: 'ip',
    header: 'IP address',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.ip ?? '—'}</span>,
  },
]

export default function AuditLogsPage() {
  const { tenantId, can } = useSession()
  const [action, setAction] = useState('')
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors[cursors.length - 1]

  const logs = useQuery({
    queryKey: keys.tenant(tenantId, 'audit', action, cursor ?? ''),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '25' })
      if (action) params.set('action', action)
      if (cursor) params.set('cursor', cursor)
      return get<{ data: AuditLog[]; page: Page }>(`/audit-logs?${params.toString()}`)
    },
    enabled: can('audit.view'),
    placeholderData: keepPreviousData,
  })

  if (!can('audit.view')) return <PermissionState what="the audit log" />

  return (
    <ListPage
      header={{
        title: 'Audit logs',
        description: 'A permanent record of sensitive changes in this workspace.',
      }}
    >
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="audit-filter">Filter by action</Label>
        <Input
          id="audit-filter"
          placeholder="e.g. team. or workspace.updated"
          value={action}
          onChange={(e) => {
            setAction(e.target.value.trim())
            setCursors([])
          }}
        />
      </div>
      <DataTable
        label="Audit log"
        columns={columns}
        data={logs.data?.data ?? []}
        getRowId={(row) => row.id}
        loading={logs.isPending}
        error={logs.isError ? { onRetry: () => void logs.refetch() } : undefined}
        empty={{ title: 'No matching entries' }}
        pagination={{
          hasPrevious: cursors.length > 0,
          hasNext: Boolean(logs.data?.page.hasMore),
          onPrevious: () => setCursors((c) => c.slice(0, -1)),
          onNext: () => {
            const next = logs.data?.page.nextCursor
            if (next) setCursors((c) => [...c, next])
          },
          summary: `Page ${cursors.length + 1}`,
        }}
      />
    </ListPage>
  )
}
