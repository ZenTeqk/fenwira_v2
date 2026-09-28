'use client'

import { type OverviewAnalytics } from '@fenwira/contracts'
import { type ColumnDef, DataTable, MetricCard, PermissionState, TrendChart } from '@fenwira/ui'
import { AlertTriangle, CheckCheck, MessageSquare, Send } from 'lucide-react'
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
import { formatMoney } from '@/lib/billing'

type Campaign = OverviewAnalytics['topCampaigns'][number]
type Flow = OverviewAnalytics['topFlows'][number]

/** Analytics → Overview (docs/ANALYTICS.md): the headline figures across modules. */
export default function AnalyticsOverviewPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<OverviewAnalytics>('overview', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Analytics"
      description="How your WhatsApp messaging, campaigns, inbox and automations are performing."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          <KpiGrid>
            <MetricCard
              label="Messages sent"
              icon={<Send />}
              value={count(d.kpis.sent.value)}
              delta={countDelta(d.kpis.sent)}
              hint="Accepted by Meta (sent, delivered or read)"
            />
            <MetricCard
              label="Delivery rate"
              icon={<CheckCheck />}
              value={percent(d.kpis.deliveryRate.value)}
              delta={rateDelta(d.kpis.deliveryRate)}
              hint={rateHint(d.kpis.deliveryRate, 'sent messages delivered')}
            />
            <MetricCard
              label="Open conversations"
              icon={<MessageSquare />}
              value={count(d.kpis.openConversations)}
              hint="Right now"
            />
            {d.kpis.chargeMinor && d.currency ? (
              <MetricCard
                label="Message charges"
                value={formatMoney(d.kpis.chargeMinor.value, d.currency)}
                delta={countDelta(d.kpis.chargeMinor, false)}
                hint={
                  <Link className="underline-offset-4 hover:underline" href="/analytics/usage">
                    See usage
                  </Link>
                }
              />
            ) : (
              <MetricCard
                label="Failed messages"
                icon={<AlertTriangle />}
                value={count(d.kpis.failed.value)}
                delta={countDelta(d.kpis.failed, false)}
                hint={`${count(d.kpis.automationFailures.value)} automation runs failed`}
              />
            )}
          </KpiGrid>
          <Panel title="Messages per day" description="Outbound messages by their latest status.">
            <TrendChart
              label="Messages per day"
              data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
              series={[
                { key: 'sent', label: 'Sent', tone: 'primary' },
                { key: 'delivered', label: 'Delivered', tone: 'info' },
                { key: 'read', label: 'Read', tone: 'success' },
                { key: 'failed', label: 'Failed', tone: 'danger' },
              ]}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Top campaigns">
              <DataTable
                label="Top campaigns"
                columns={campaignColumns}
                data={d.topCampaigns}
                getRowId={(c) => c.campaignId}
                empty={{ title: 'No campaigns ran in this period.' }}
              />
            </Panel>
            <Panel title="Top automations">
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
        className="font-medium text-slate underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'recipients',
    header: 'Recipients',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.recipients),
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
        className="font-medium text-slate underline-offset-4 hover:underline"
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
