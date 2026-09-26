'use client'

import { type Flow } from '@fenwira/contracts'
import { Button, type ColumnDef, DataTable, PageHeader, StatusBadge } from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { NODE_LABEL, useFlows } from '@/lib/automation'

/** Automations list (docs/AUTOMATION_ENGINE.md). Ordered as they run: priority, then age. */
export default function AutomationsPage() {
  const { can } = useSession()
  const flows = useFlows()
  if (!can('automations.read')) return <NoAccess what="automations" />
  const columns: Array<ColumnDef<Flow>> = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link
          href={`/automations/${row.original.id}`}
          className="font-medium text-slate underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automations"
        description="Flows that run on their own when a message, contact or webhook arrives. An agent replying stops them for that conversation."
        actions={
          can('automations.write') ? (
            <Button asChild>
              <Link href="/automations/new">
                <Plus aria-hidden="true" />
                New automation
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        label="Automations"
        columns={columns}
        data={flows.data ?? []}
        getRowId={(f) => f.id}
        loading={flows.isPending}
        empty={{
          title: 'No automations yet',
          description: 'Create one to answer keywords, welcome new contacts or call your systems.',
        }}
      />
    </div>
  )
}
