'use client'
import type { Campaign } from '@fenwira/contracts'
import {
  Button,
  cn,
  type ColumnDef,
  DataTable,
  focusRing,
  Pagination,
  Skeleton,
  StatusBadge,
} from '@fenwira/ui'
import { Users } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { campaignResultsLive, percent, useCampaignStats } from '@/lib/campaigns'
import { CampaignArtwork, CampaignActions } from './campaign-identity'

function ResultsCell({
  campaign,
  field,
}: {
  campaign: Campaign
  field: 'sent' | 'deliveryRate' | 'readRate'
}) {
  const results = useCampaignStats(
    campaign.id,
    campaignResultsLive(campaign),
    Boolean(campaign.audienceSnapshotAt),
  )
  if (!campaign.audienceSnapshotAt) return <span className="text-muted">—</span>
  if (results.isPending) return <Skeleton className="h-4 w-12" />
  if (results.isError || !results.data)
    return (
      <Button variant="link" size="sm" onClick={() => void results.refetch()}>
        Retry results
      </Button>
    )
  return (
    <span className="tabular-nums">
      {field === 'sent' ? results.data.sent.toLocaleString('en-IN') : percent(results.data[field])}
    </span>
  )
}

export function CampaignHistory({
  history,
  page,
  onPageChange,
  audienceLabel,
  drafts,
}: {
  history: Campaign[]
  page: number
  onPageChange: (page: number) => void
  audienceLabel: (campaign: Campaign) => string
  drafts: boolean
}) {
  const columns = useMemo<Array<ColumnDef<Campaign>>>(
    () => [
      {
        accessorKey: 'name',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <CampaignArtwork campaign={row.original} small />
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/campaigns/${row.original.id}`}
                className={cn('font-semibold text-slate hover:underline', focusRing)}
              >
                {row.original.name}
              </Link>
              <span className="text-xs text-secondary">
                {row.original.template?.name ??
                  (row.original.status === 'DRAFT'
                    ? 'Draft · message chosen in Studio'
                    : 'Message not frozen')}
              </span>
            </div>
          </div>
        ),
      },
      {
        id: 'audience',
        header: 'Audience',
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <Users aria-hidden="true" className="size-5 shrink-0 text-muted" />
            <div>
              <p>{audienceLabel(row.original)}</p>
              {row.original.audienceSnapshotAt ? (
                <p className="text-xs">
                  {row.original.totalRecipients.toLocaleString('en-IN')} recipients
                </p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} context="campaign" />,
      },
      {
        id: 'sent',
        header: 'Sent',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="sent" />,
      },
      {
        id: 'delivered',
        header: 'Delivered',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="deliveryRate" />,
      },
      {
        id: 'read',
        header: 'Read',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="readRate" />,
      },
      {
        id: 'when',
        header: 'Date',
        cell: ({ row }) => {
          const c = row.original
          const at = c.status === 'SCHEDULED' ? c.scheduleAt : (c.startedAt ?? c.launchedAt)
          return (
            <span className="whitespace-nowrap text-xs text-secondary">
              {new Intl.DateTimeFormat('en-IN', {
                dateStyle: 'medium',
                timeZone: c.timezone,
              }).format(new Date(at ?? c.createdAt))}
            </span>
          )
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => <CampaignActions campaign={row.original} />,
      },
    ],
    // Catalog names are display-only; their absence never changes the saved audience.
    [audienceLabel],
  )

  const currentHistoryPage = Math.min(page, Math.max(0, Math.ceil(history.length / 5) - 1))
  const historyStart = currentHistoryPage * 5
  return (
    <section
      aria-label="Campaign history"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <h2 className="border-b border-border px-4 py-3 text-md font-semibold text-slate">
        {drafts ? 'Drafts' : 'Campaign history'}
      </h2>
      <div className="[&_[data-slot=table-container]]:rounded-none [&_[data-slot=table-container]]:border-0 [&_thead]:bg-surface [&_td]:py-2 [&_th]:py-2">
        <DataTable
          label="Campaigns"
          columns={columns}
          data={history.slice(historyStart, historyStart + 5)}
          getRowId={(c) => c.id}
          empty={{ title: 'No history yet' }}
        />
      </div>
      <Pagination
        className="border-t border-border px-4 py-3"
        hasPrevious={currentHistoryPage > 0}
        hasNext={historyStart + 5 < history.length}
        onPrevious={() => onPageChange(currentHistoryPage - 1)}
        onNext={() => onPageChange(currentHistoryPage + 1)}
        summary={`${historyStart + 1}–${Math.min(historyStart + 5, history.length)} of ${history.length} loaded campaigns`}
      />
    </section>
  )
}
