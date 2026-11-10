'use client'

import {
  type InboxAnalytics,
  type MessagingAnalytics,
  type OverviewAnalytics,
} from '@fenwira/contracts'
import {
  type ColumnDef,
  DataTable,
  MetricCard,
  PermissionState,
  TrendChart,
  cn,
  textLink,
} from '@fenwira/ui'
import { CheckCheck, MessageSquare, Receipt, Send } from 'lucide-react'
import Link from 'next/link'
import { AnalyticsFrame, Panel, SummaryGrid } from '@/components/analytics/analytics-frame'
import { useSession } from '@/components/session/session-provider'
import {
  activeDays,
  count,
  countDelta,
  latestStatusSeries,
  percent,
  rateDelta,
  shortDay,
  useAnalytics,
  useAnalyticsRange,
} from '@/lib/analytics'
import { EngagementSummary, TeamSummary } from '@/components/analytics/overview-context'
import { formatMoney } from '@/lib/billing'

type Campaign = OverviewAnalytics['topCampaigns'][number]
type Flow = OverviewAnalytics['topFlows'][number]

/**
 * Latest-status series, stacked bottom → top. The buckets are mutually exclusive, so stacking
 * and the daily total are valid (lib/analytics-format → latestStatusSeries).
 */
const STATUS_SERIES = [
  { key: 'read', label: 'Read', tone: 'stage3' },
  { key: 'deliveredOnly', label: 'Delivered, not read', tone: 'stage1' },
  { key: 'sentOnly', label: 'Sent, not delivered', tone: 'other' },
  { key: 'failed', label: 'Failed', tone: 'critical' },
] as const

/** Fallback when the nested counts don't satisfy read ≤ delivered ≤ sent: never stacked. */
const NESTED_SERIES = [
  { key: 'sent', label: 'Sent (incl. delivered and read)', tone: 'stage1' },
  { key: 'delivered', label: 'Delivered (incl. read)', tone: 'stage2' },
  { key: 'read', label: 'Read', tone: 'stage3' },
  { key: 'failed', label: 'Failed', tone: 'critical' },
] as const

/** Analytics → Overview (docs/ANALYTICS.md): the headline figures across modules. */
export default function AnalyticsOverviewPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<OverviewAnalytics>('overview', range, can('analytics.read'))
  const messaging = useAnalytics<MessagingAnalytics>('messaging', range, can('analytics.read'))
  const inbox = useAnalytics<InboxAnalytics>('inbox', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Analytics"
      description="Track messaging, engagement, and team performance."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => {
        const days = activeDays(d.series)
        const buckets = latestStatusSeries(d.series)
        const chargeMinor = d.kpis.chargeMinor
        const currency = d.currency
        return (
          <>
            <SummaryGrid>
              <MetricCard
                appearance="summary"
                label="Messages sent"
                icon={<Send />}
                value={count(d.kpis.sent.value)}
                delta={countDelta(d.kpis.sent, 'neutral')}
                info="Outbound messages accepted by Meta: their latest status is sent, delivered or read. Pending and failed messages aren’t included."
                hint={
                  d.kpis.sent.previous === null
                    ? 'In the selected period'
                    : `${count(d.kpis.sent.previous)} in the previous period`
                }
              />
              <MetricCard
                appearance="summary"
                label="Delivery rate"
                icon={<CheckCheck />}
                value={percent(d.kpis.deliveryRate.value)}
                delta={rateDelta(d.kpis.deliveryRate)}
                info="Delivered ÷ sent. Delivered includes messages that were also read."
                hint={
                  d.kpis.deliveryRate.denominator === 0
                    ? 'No sent messages in this period'
                    : `${count(d.kpis.deliveryRate.numerator)} of ${count(d.kpis.deliveryRate.denominator)} sent delivered`
                }
              />
              <MetricCard
                appearance="summary"
                label="Open conversations"
                icon={<MessageSquare />}
                value={count(d.kpis.openConversations)}
                info="Conversations open right now. The date range doesn’t change this figure."
                hint="Current snapshot"
              />
              {chargeMinor && currency && can('billing.read') ? (
                <MetricCard
                  appearance="summary"
                  label="Message charges"
                  icon={<Receipt />}
                  value={formatMoney(chargeMinor.value, currency)}
                  delta={countDelta(chargeMinor, 'neutral', (n) => formatMoney(n, currency))}
                  info="Charges recorded for billable messages in this period, from usage records."
                  hint={
                    <Link className={textLink} href="/analytics/usage">
                      View usage
                    </Link>
                  }
                />
              ) : (
                // No billing access (the API omits money for it), not zero charges.
                <MetricCard
                  appearance="summary"
                  label="Message charges"
                  icon={<Receipt />}
                  value={<span aria-label="Not available">—</span>}
                  info="Charges are shown to members with billing access."
                  hint="Requires billing access"
                />
              )}
            </SummaryGrid>
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
              <div className="min-w-0 xl:col-span-2">
                <Panel
                  title="Messaging activity"
                  description={
                    buckets
                      ? 'Outbound messages per day sent, by each message’s latest status. Pending messages are excluded.'
                      : 'Outbound messages per day sent. Sent includes delivered and read messages, so the columns overlap and aren’t stacked. Pending messages are excluded.'
                  }
                >
                  {buckets ? (
                    <TrendChart
                      label="Messages per day by latest status"
                      variant="stacked"
                      viewToggle="segmented"
                      integerTicks
                      totalLabel="Messages represented (pending excluded)"
                      height={300}
                      data={buckets.map((p) => ({ label: shortDay(p.day), values: p.values }))}
                      series={[...STATUS_SERIES]}
                    />
                  ) : (
                    <TrendChart
                      label="Messages per day by status"
                      variant="bar"
                      viewToggle="segmented"
                      integerTicks
                      height={300}
                      data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
                      series={[...NESTED_SERIES]}
                    />
                  )}
                  {days.total > 1 ? (
                    <p className="mt-3 text-xs text-fg-secondary">
                      {days.active === 0
                        ? 'No outbound messages in this period.'
                        : `Outbound activity on ${count(days.active)} of ${count(days.total)} days.`}
                    </p>
                  ) : null}
                </Panel>
              </div>
              <EngagementSummary query={messaging} />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
                <Panel
                  title="Campaign performance"
                  description="Largest campaigns that ran in this period."
                  action={
                    <Link
                      href="/analytics/campaigns"
                      className={cn('text-sm font-medium', textLink)}
                    >
                      View all →
                    </Link>
                  }
                >
                  <DataTable
                    label="Top campaigns"
                    columns={campaignColumns}
                    data={d.topCampaigns}
                    getRowId={(c) => c.campaignId}
                    empty={{ title: 'No campaigns ran in this period.' }}
                  />
                </Panel>
                <Panel
                  title="Automation performance"
                  action={
                    <Link
                      href="/analytics/automations"
                      className={cn('text-sm font-medium', textLink)}
                    >
                      View all →
                    </Link>
                  }
                >
                  <DataTable
                    label="Top automations"
                    columns={flowColumns}
                    data={d.topFlows}
                    getRowId={(f) => f.flowId}
                    empty={{ title: 'No automation runs in this period.' }}
                  />
                </Panel>
              </div>
              <TeamSummary query={inbox} />
            </div>
          </>
        )
      }}
    </AnalyticsFrame>
  )
}

const campaignColumns: Array<ColumnDef<Campaign>> = [
  {
    id: 'name',
    header: 'Campaign',
    cell: ({ row }) => (
      <Link
        href={`/campaigns/${row.original.campaignId}`}
        className="inline-block min-w-40 font-medium break-words text-fg underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'sent',
    header: 'Sent',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.sent),
  },
  {
    id: 'delivery',
    header: 'Delivery rate',
    meta: { align: 'right' },
    cell: ({ row }) => percent(row.original.deliveryRate),
  },
  {
    id: 'read',
    header: 'Read rate',
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

const flowColumns: Array<ColumnDef<Flow>> = [
  {
    id: 'name',
    header: 'Automation',
    cell: ({ row }) => (
      <Link
        href={`/automations/${row.original.flowId}`}
        className="inline-block min-w-40 font-medium break-words text-fg underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'runs',
    header: 'Runs',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.executions),
  },
]
