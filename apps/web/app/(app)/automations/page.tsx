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
import { LayoutTemplate, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'
import { triggerClause } from '@/lib/automation-summary'
import { relativeTime } from '@/lib/relative-time'

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
        <span className="flex flex-col gap-0.5">
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
          <span className="text-sm text-secondary">
            {triggerClause(row.original.trigger ?? undefined)}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={row.original.status === 'ACTIVE' ? 'Live' : undefined}
        />
      ),
    },
    {
      id: 'runs',
      header: 'Runs, last 7 days',
      cell: ({ row }) => (
        <Link
          href={`/automations/${row.original.id}/history`}
          className="text-slate underline-offset-4 hover:underline"
        >
          {row.original.executions.last7d.toLocaleString('en-IN')}
          {row.original.executions.running ? ` (${row.original.executions.running} running)` : ''}
        </Link>
      ),
    },
    {
      id: 'edited',
      header: 'Last edited',
      cell: ({ row }) => {
        const at = row.original.draftUpdatedAt ?? row.original.updatedAt
        return (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="text-secondary">
            {relativeTime(at)}
          </time>
        )
      },
    },
    { id: 'priority', header: 'Priority', cell: ({ row }) => row.original.priority },
  ]
  const write = can('automations.write')
  return (
    <ListPage
      header={{
        title: 'Automations',
        description:
          'Automations reply, tag, assign and follow up on their own when a message, contact or webhook arrives. A teammate replying stops them for that conversation.',
        actions: write ? (
          <Button asChild>
            <Link href="/automations/new">
              <Plus aria-hidden="true" />
              Create automation
            </Link>
          </Button>
        ) : null,
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
            'Automations welcome new contacts, answer keywords, capture leads and send order updates, even when nobody is online. Start from a template in a couple of minutes.',
          action: write ? (
            <Button asChild>
              <Link href="/automations/new">
                <LayoutTemplate aria-hidden="true" />
                Browse templates
              </Link>
            </Button>
          ) : undefined,
        }}
      />
    </ListPage>
  )
}
