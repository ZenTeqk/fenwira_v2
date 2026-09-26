'use client'

import { type Campaign } from '@fenwira/contracts'
import { Button, type ColumnDef, DataTable, PageHeader, StatusBadge } from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { formatInZone, useCampaigns } from '@/lib/campaigns'

/** Campaign list (docs/CAMPAIGN_ENGINE.md). */
export default function CampaignsPage() {
  const { can } = useSession()
  const campaigns = useCampaigns()
  if (!can('campaigns.read')) return <NoAccess what="campaigns" />
  const columns: Array<ColumnDef<Campaign>> = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link
          href={`/campaigns/${row.original.id}`}
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
    { id: 'template', header: 'Template', cell: ({ row }) => row.original.template?.name ?? '—' },
    {
      id: 'recipients',
      header: 'Recipients',
      cell: ({ row }) =>
        row.original.totalRecipients ? row.original.totalRecipients.toLocaleString('en-IN') : '—',
    },
    {
      id: 'when',
      header: 'Scheduled or started',
      cell: ({ row }) => {
        const c = row.original
        const at = c.status === 'SCHEDULED' ? c.scheduleAt : (c.startedAt ?? c.launchedAt)
        return at ? formatInZone(at, c.timezone) : '—'
      },
    },
  ]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Send an approved template to many contacts at once, now or at a set time."
        actions={
          can('campaigns.write') ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus aria-hidden="true" />
                New campaign
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        label="Campaigns"
        columns={columns}
        data={campaigns.data ?? []}
        getRowId={(c) => c.id}
        loading={campaigns.isPending}
        empty={{
          title: 'No campaigns yet',
          description: 'Create one to reach a segment, a tag or an import.',
        }}
      />
    </div>
  )
}
