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
import { AlertTriangle, CheckCheck, MessageSquare, Receipt, Send } from 'lucide-react'
import Link from 'next/link'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
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
import { EngagementSummary, TeamSummary } from '@/components/analytics/overview-context'
import { formatMoney } from '@/lib/billing'

type Campaign = OverviewAnalytics['topCampaigns'][number]
type Flow = OverviewAnalytics['topFlows'][number]

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
      description="Understand how customers engage with your WhatsApp communication."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          <KpiGrid>
            <MetricCard
              appearance="analytics"
              label="Messages sent"
              icon={<Send />}
              value={count(d.kpis.sent.value)}
              delta={countDelta(d.kpis.sent)}
              hint="Accepted by Meta (sent, delivered or read)"
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
              label="Open conversations"
              icon={<MessageSquare />}
              value={count(d.kpis.openConversations)}
              hint="Right now"
            />
            {d.kpis.chargeMinor && d.currency ? (
              <MetricCard
                appearance="analytics"
                label="Message charges"
                icon={<Receipt />}
                value={formatMoney(d.kpis.chargeMinor.value, d.currency)}
                delta={countDelta(d.kpis.chargeMinor, false)}
                hint={
                  <Link className={textLink} href="/analytics/usage">
                    See usage
                  </Link>
                }
              />
            ) : (
              <MetricCard
                appearance="analytics"
                label="Failed messages"
                icon={<AlertTriangle />}
                value={count(d.kpis.failed.value)}
                delta={countDelta(d.kpis.failed, false)}
                hint={`${count(d.kpis.automationFailures.value)} automation runs failed`}
              />
            )}
          </KpiGrid>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <Panel
                title="Messaging activity"
                description="Outbound messages by their latest status, per day."
              >
                <TrendChart
                  label="Messages per day"
                  height={160}
                  data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
                  series={[
                    { key: 'sent', label: 'Sent', tone: 'stage1' },
                    { key: 'delivered', label: 'Delivered', tone: 'stage2' },
                    { key: 'read', label: 'Read', tone: 'stage3' },
                    { key: 'failed', label: 'Failed', tone: 'critical' },
                  ]}
                />
              </Panel>
            </div>
            <EngagementSummary query={messaging} />
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <Panel
              title="Campaign performance"
              action={
                <Link href="/analytics/campaigns" className={cn('text-sm font-medium', textLink)}>
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
            <TeamSummary query={inbox} />
            <Panel
              title="Automation performance"
              action={
                <Link href="/analytics/automations" className={cn('text-sm font-medium', textLink)}>
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
        </>
      )}
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
        className="font-medium text-fg underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'recipients',
    header: 'Sent',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.sent),
  },
  {
    id: 'delivery',
    header: 'Delivered',
    meta: { align: 'right' },
    cell: ({ row }) => percent(row.original.deliveryRate),
  },
]

const flowColumns: Array<ColumnDef<Flow>> = [
  {
    id: 'name',
    header: 'Automation',
    cell: ({ row }) => (
      <Link
        href={`/automations/${row.original.flowId}`}
        className="font-medium text-fg underline-offset-4 hover:underline"
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
