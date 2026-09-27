'use client'

import { type Campaign } from '@fenwira/contracts'
import {
  Alert,
  Button,
  type ColumnDef,
  DataTable,
  ListPage,
  PermissionState,
  StatusBadge,
} from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { formatInZone, useCampaigns } from '@/lib/campaigns'

/** Campaign list (docs/CAMPAIGN_ENGINE.md). */
export default function CampaignsPage() {
  const { can } = useSession()
  const campaigns = useCampaigns()
  if (!can('campaigns.read')) return <PermissionState what="campaigns" />
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
  const paused = (campaigns.data ?? []).filter((c) => c.status.startsWith('PAUSED'))
  return (
    <ListPage
      header={{
        title: 'Campaigns',
        description: 'Send an approved template to many contacts at once, now or at a set time.',
        actions: can('campaigns.write') ? (
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus aria-hidden="true" />
              New campaign
            </Link>
          </Button>
        ) : null,
      }}
      banner={
        paused.length ? (
          <Alert
            tone="warning"
            title={`${paused.length} campaign${paused.length > 1 ? 's are' : ' is'} paused`}
          >
            {paused.map((c) => c.name).join(', ')}. Open a campaign to see why and resume it.
          </Alert>
        ) : undefined
      }
    >
      <DataTable
        label="Campaigns"
        columns={columns}
        data={campaigns.data ?? []}
        getRowId={(c) => c.id}
        loading={campaigns.isPending}
        error={campaigns.isError ? { onRetry: () => void campaigns.refetch() } : undefined}
        empty={{
          title: 'No campaigns yet',
          description:
            'A campaign sends one approved template to a group of contacts: a tag, a segment or an import. Only contacts who can receive it are included, and you review everything before it goes.',
          action: can('campaigns.write') ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus aria-hidden="true" />
                Create your first campaign
              </Link>
            </Button>
          ) : undefined,
        }}
      />
    </ListPage>
  )
}
