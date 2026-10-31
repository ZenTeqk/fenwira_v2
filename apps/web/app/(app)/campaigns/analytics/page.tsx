'use client'

import { type Campaign, type CampaignStats } from '@fenwira/contracts'
import { type ColumnDef, DataTable, ListPage, PermissionState, StatusBadge } from '@fenwira/ui'
import { useQueries } from '@tanstack/react-query'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { campaignsKey, percent, useCampaigns } from '@/lib/campaigns'

type Row = Campaign & { stats?: CampaignStats }

/**
 * Campaign results at a glance (operational only; workspace analytics is Phase 11): the most
 * recent 25 launched campaigns with their delivery, read and failure rates.
 */
export default function CampaignAnalyticsPage() {
  const { tenantId, can } = useSession()
  const campaigns = useCampaigns()
  const launched = (campaigns.data ?? [])
    .filter((c) => !['DRAFT', 'SCHEDULED'].includes(c.status))
    .slice(0, 25)
  const stats = useQueries({
    queries: launched.map((c) => ({
      queryKey: campaignsKey(tenantId, 'stats', c.id),
      queryFn: () => get<{ data: CampaignStats }>(`/campaigns/${c.id}/stats`).then((r) => r.data),
    })),
  })
  if (!can('campaigns.read')) return <PermissionState what="campaigns" />
  const rows: Row[] = launched.map((c, i) => ({ ...c, stats: stats[i]?.data }))
  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-IN'))
  const columns: Array<ColumnDef<Row>> = [
    {
      accessorKey: 'name',
      header: 'Campaign',
      cell: ({ row }) => (
        <Link
          href={`/campaigns/${row.original.id}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
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
    { id: 'sent', header: 'Sent', cell: ({ row }) => n(row.original.stats?.sent) },
    {
      id: 'delivery',
      header: 'Delivery rate',
      cell: ({ row }) => percent(row.original.stats?.deliveryRate ?? null),
    },
    {
      id: 'read',
      header: 'Read rate',
      cell: ({ row }) => percent(row.original.stats?.readRate ?? null),
    },
    {
      id: 'failure',
      header: 'Failure rate',
      cell: ({ row }) => percent(row.original.stats?.failureRate ?? null),
    },
    { id: 'skipped', header: 'Skipped', cell: ({ row }) => n(row.original.stats?.skipped) },
  ]
  return (
    <ListPage
      header={{
        title: 'Campaign analytics',
        description: 'Delivery and engagement for your recent campaigns.',
      }}
    >
      <DataTable
        label="Campaign results"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={campaigns.isPending}
        error={campaigns.isError ? { onRetry: () => void campaigns.refetch() } : undefined}
        empty={{
          title: 'No launched campaigns yet',
          description: 'Results appear here once a campaign starts.',
        }}
      />
    </ListPage>
  )
}
