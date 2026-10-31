'use client'

import { type ContactCampaign, type Page } from '@fenwira/contracts'
import {
  type ColumnDef,
  DataTable,
  PermissionState,
  StatusBadge,
  type StatusKey,
} from '@fenwira/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const at = (iso: string | null) => (iso ? when.format(new Date(iso)) : '—')

/** The latest thing that happened to this contact's message, for the "Last update" column. */
function lastUpdate(r: ContactCampaign): string {
  if (r.failedAt) return `Failed ${at(r.failedAt)}${r.errorCode ? ` (${r.errorCode})` : ''}`
  if (r.readAt) return `Read ${at(r.readAt)}`
  if (r.deliveredAt) return `Delivered ${at(r.deliveredAt)}`
  if (r.sentAt) return `Sent ${at(r.sentAt)}`
  if (r.skipReason) return `Excluded: ${r.skipReason.toLowerCase().replaceAll('_', ' ')}`
  return 'Not sent yet'
}

const columns: Array<ColumnDef<ContactCampaign>> = [
  {
    id: 'campaign',
    header: 'Campaign',
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <Link
          href={`/campaigns/${row.original.campaignId}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        <StatusBadge status={row.original.campaignStatus as StatusKey} />
      </div>
    ),
  },
  {
    id: 'status',
    header: 'This contact',
    cell: ({ row }) => <StatusBadge status={row.original.recipientStatus as StatusKey} />,
  },
  { id: 'last', header: 'Last update', cell: ({ row }) => lastUpdate(row.original) },
  { id: 'added', header: 'Added', cell: ({ row }) => at(row.original.createdAt) },
]

/**
 * Contact → Campaigns: the campaigns this contact was part of, from the campaign recipient
 * records (the authoritative relation).
 */
export function ContactCampaigns({ contactId }: { contactId: string }) {
  const { tenantId, can } = useSession()
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors[cursors.length - 1]
  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'contact-campaigns', contactId, cursor ?? ''),
    queryFn: () =>
      get<{ data: ContactCampaign[]; page: Page }>(
        `/contacts/${contactId}/campaigns?limit=25${cursor ? `&cursor=${cursor}` : ''}`,
      ),
    enabled: can('campaigns.read'),
    placeholderData: keepPreviousData,
  })
  if (!can('campaigns.read'))
    return <PermissionState what="campaigns" permission="campaigns.read" />
  return (
    <DataTable
      label="Campaigns for this contact"
      columns={columns}
      data={list.data?.data ?? []}
      getRowId={(r) => r.campaignId}
      loading={list.isPending}
      error={list.isError ? { onRetry: () => void list.refetch() } : undefined}
      empty={{
        title: 'Not in any campaign yet',
        description:
          'Campaigns that include this contact are listed here with their delivery status.',
      }}
      pagination={
        cursors.length || list.data?.page.hasMore
          ? {
              hasPrevious: cursors.length > 0,
              hasNext: Boolean(list.data?.page.hasMore),
              onPrevious: () => setCursors((c) => c.slice(0, -1)),
              onNext: () => {
                const next = list.data?.page.nextCursor
                if (next) setCursors((c) => [...c, next])
              },
              summary: `Page ${cursors.length + 1}`,
            }
          : undefined
      }
    />
  )
}
