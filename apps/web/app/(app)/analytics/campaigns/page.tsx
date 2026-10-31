'use client'

import { type CampaignAnalyticsRow, type CampaignsAnalytics } from '@fenwira/contracts'
import {
  type ColumnDef,
  DataTable,
  MetricCard,
  PermissionState,
  StatusBadge,
  type StatusKey,
  TrendChart,
} from '@fenwira/ui'
import { CheckCheck, Eye, Megaphone, Users } from 'lucide-react'
import Link from 'next/link'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
import { BreakdownTable } from '@/components/analytics/breakdown-table'
import { useSession } from '@/components/session/session-provider'
import {
  count,
  countDelta,
  percent,
  rateDelta,
  rateHint,
  shortDay,
  useAnalytics,
  useAnalyticsRange,
} from '@/lib/analytics'

const columns: Array<ColumnDef<CampaignAnalyticsRow>> = [
  {
    id: 'name',
    header: 'Campaign',
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <Link
          href={`/campaigns/${row.original.campaignId}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="text-sm text-fg-muted">Started {shortDay(row.original.startedDay)}</span>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status as StatusKey} />,
  },
  {
    id: 'recipients',
    header: 'Recipients',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.recipients),
  },
  {
    id: 'skipped',
    header: 'Excluded',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.skipped),
  },
  {
    id: 'sent',
    header: 'Sent',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.sent),
  },
  {
    id: 'delivered',
    header: 'Delivered',
    meta: { align: 'right' },
    cell: ({ row }) => percent(row.original.deliveryRate),
  },
  {
    id: 'read',
    header: 'Read',
    meta: { align: 'right' },
    cell: ({ row }) => percent(row.original.readRate),
  },
  {
    id: 'failed',
    header: 'Failed',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.failed),
  },
]

/**
 * Analytics → Campaigns. Recipient outcomes come from campaign_recipients (the authoritative
 * state); each campaign counts in the period in which it started.
 */
export default function CampaignAnalyticsPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<CampaignsAnalytics>('campaigns', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Campaign analytics"
      description="Results of the campaigns that started in this period."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          <KpiGrid>
            <MetricCard
              appearance="analytics"
              label="Campaigns"
              icon={<Megaphone />}
              value={count(d.kpis.campaigns.value)}
              delta={countDelta(d.kpis.campaigns)}
              hint={`${count(d.kpis.skipped.value)} recipients excluded`}
            />
            <MetricCard
              appearance="analytics"
              label="Recipients"
              icon={<Users />}
              value={count(d.kpis.recipients.value)}
              delta={countDelta(d.kpis.recipients)}
              hint={`${count(d.kpis.sent.value)} sent · ${count(d.kpis.failed.value)} failed`}
            />
            <MetricCard
              appearance="analytics"
              label="Delivery rate"
              icon={<CheckCheck />}
              value={percent(d.kpis.deliveryRate.value)}
              delta={rateDelta(d.kpis.deliveryRate)}
              hint={rateHint(d.kpis.deliveryRate, 'sent messages delivered')}
            />
            <MetricCard
              appearance="analytics"
              label="Read rate"
              icon={<Eye />}
              value={percent(d.kpis.readRate.value)}
              delta={rateDelta(d.kpis.readRate)}
              hint={rateHint(d.kpis.readRate, 'delivered messages read')}
            />
          </KpiGrid>
          <Panel title="Results by campaign" description="Up to the 12 most recent campaigns.">
            <TrendChart
              label="Recipient outcomes by campaign"
              variant="stacked"
              pointHeader="Campaign"
              data={d.campaigns
                .slice(0, 12)
                .reverse()
                .map((c) => ({
                  label: c.name.length > 14 ? `${c.name.slice(0, 13)}…` : c.name,
                  values: {
                    read: c.read,
                    delivered: c.delivered - c.read,
                    sent: c.sent - c.delivered,
                    failed: c.failed,
                    skipped: c.skipped,
                  },
                }))}
              series={[
                { key: 'read', label: 'Read', tone: 'stage3' },
                { key: 'delivered', label: 'Delivered, not read', tone: 'stage2' },
                { key: 'sent', label: 'Sent, not delivered', tone: 'stage1' },
                { key: 'failed', label: 'Failed', tone: 'critical' },
                { key: 'skipped', label: 'Excluded', tone: 'other' },
              ]}
            />
          </Panel>
          <Panel title="Campaigns">
            <DataTable
              label="Campaign results"
              columns={columns}
              data={d.campaigns}
              getRowId={(c) => c.campaignId}
              empty={{ title: 'No campaigns started in this period.' }}
            />
          </Panel>
          <Panel title="Why recipients were excluded">
            <BreakdownTable
              label="Exclusion reasons"
              dimension="Reason"
              rows={d.skipReasons}
              columns={[{ key: 'skipped', label: 'Recipients' }]}
              empty="No recipients were excluded."
            />
          </Panel>
        </>
      )}
    </AnalyticsFrame>
  )
}
