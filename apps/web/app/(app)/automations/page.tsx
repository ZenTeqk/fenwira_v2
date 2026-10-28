'use client'

import { type Flow } from '@fenwira/contracts'
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  ListPage,
  PermissionState,
  StatusBadge,
} from '@fenwira/ui'
import { Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { NODE_LABEL, useFlows } from '@/lib/automation'

/** Automations list (docs/AUTOMATION_ENGINE.md). Ordered as they run: priority, then age. */
export default function AutomationsPage() {
  const { can } = useSession()
  const flows = useFlows()
  if (!can('automations.read')) return <PermissionState what="automations" />
  const columns: Array<ColumnDef<Flow>> = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={`/automations/${row.original.id}`}
            className="font-medium text-slate underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
          {row.original.managedBy === 'AI_ASSISTANT' ? (
            <Badge tone="neutral" icon={<Sparkles aria-hidden="true" />}>
              Managed by AI Assistant
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'trigger',
      header: 'Trigger',
      cell: ({ row }) => (row.original.triggerType ? NODE_LABEL[row.original.triggerType] : '—'),
    },
    { id: 'priority', header: 'Priority', cell: ({ row }) => row.original.priority },
    {
      id: 'version',
      header: 'Live version',
      cell: ({ row }) => row.original.activeVersion ?? '—',
    },
    {
      id: 'runs',
      header: 'Runs',
      cell: ({ row }) => (
        <Link
          href={`/automations/${row.original.id}/history`}
          className="text-slate underline-offset-4 hover:underline"
        >
          {row.original.executions.total.toLocaleString('en-IN')}
          {row.original.executions.running ? ` (${row.original.executions.running} running)` : ''}
        </Link>
      ),
    },
  ]
  const newButton = can('automations.write') ? (
    <Button asChild>
      <Link href="/automations/new">
        <Plus aria-hidden="true" />
        New automation
      </Link>
    </Button>
  ) : null
  return (
    <ListPage
      header={{
        title: 'Automations',
        description:
          'Flows that run on their own when a message, contact or webhook arrives. An agent replying stops them for that conversation.',
        actions: newButton,
      }}
    >
      <DataTable
        label="Automations"
        columns={columns}
        data={flows.data ?? []}
        getRowId={(f) => f.id}
        loading={flows.isPending}
        error={flows.isError ? { onRetry: () => void flows.refetch() } : undefined}
        empty={{
          title: 'No automations yet',
          description:
            'Automations answer keywords, welcome new customers, tag and assign conversations, or call your systems, even when nobody is online. Start from a ready-made recipe.',
          action: can('automations.write') ? (
            <Button asChild>
              <Link href="/automations/new">
                <Plus aria-hidden="true" />
                Create your first automation
              </Link>
            </Button>
          ) : undefined,
        }}
      />
    </ListPage>
  )
}
