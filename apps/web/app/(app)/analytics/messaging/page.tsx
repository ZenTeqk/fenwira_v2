'use client'

import { type MessagingAnalytics } from '@fenwira/contracts'
import { MetricCard, PermissionState, TrendChart } from '@fenwira/ui'
import { AlertTriangle, CheckCheck, Eye, Send } from 'lucide-react'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
import { BreakdownTable, type BreakdownColumn } from '@/components/analytics/breakdown-table'
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

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const STATUS_COLUMNS: BreakdownColumn[] = [
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'read', label: 'Read' },
  { key: 'failed', label: 'Failed' },
  {
    key: 'rate',
    label: 'Delivery rate',
    format: (_v, r) => percent(ratio(r.values.delivered ?? 0, r.values.sent ?? 0)),
  },
]

/**
 * Analytics → Messaging. Outbound messages are counted on the day they were accepted, by their
 * latest status; rates use documented denominators (docs/ANALYTICS.md → Messaging).
 */
export default function MessagingAnalyticsPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<MessagingAnalytics>('messaging', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Messaging"
      description="Outbound WhatsApp messages and what happened to them."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          <KpiGrid>
            <MetricCard
              appearance="analytics"
              label="Sent"
              icon={<Send />}
              value={count(d.kpis.sent.value)}
              delta={countDelta(d.kpis.sent)}
              hint={`${count(d.kpis.inbound.value)} received from customers`}
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
            <MetricCard
              appearance="analytics"
              label="Failure rate"
              icon={<AlertTriangle />}
              value={percent(d.kpis.failureRate.value)}
              delta={rateDelta(d.kpis.failureRate, false)}
              hint={rateHint(d.kpis.failureRate, 'messages failed')}
            />
          </KpiGrid>
          <Panel title="Volume by status" description="Per day, by the day each message was sent.">
            <TrendChart
              label="Messages per day by status"
              data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
              series={[
                { key: 'sent', label: 'Sent', tone: 'stage1' },
                { key: 'delivered', label: 'Delivered', tone: 'stage2' },
                { key: 'read', label: 'Read', tone: 'stage3' },
                { key: 'failed', label: 'Failed', tone: 'critical' },
              ]}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel
              title="By message category"
              description="Template category; free-form replies are service messages."
            >
              <BreakdownTable
                label="Messages by category"
                dimension="Category"
                rows={d.byCategory}
                columns={STATUS_COLUMNS}
              />
            </Panel>
            <Panel title="By source">
              <BreakdownTable
                label="Messages by source"
                dimension="Source"
                rows={d.bySource}
                columns={STATUS_COLUMNS}
              />
            </Panel>
            <Panel title="By phone number">
              <BreakdownTable
                label="Messages by phone number"
                dimension="Number"
                rows={d.byPhoneNumber}
                columns={STATUS_COLUMNS}
              />
            </Panel>
            <Panel title="Failure reasons" description="Error codes reported for failed messages.">
              <BreakdownTable
                label="Failure reasons"
                dimension="Reason"
                rows={d.failureReasons}
                columns={[{ key: 'failed', label: 'Failed' }]}
                empty="No failed messages in this period."
              />
            </Panel>
          </div>
        </>
      )}
    </AnalyticsFrame>
  )
}
