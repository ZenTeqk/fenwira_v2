'use client'

import { type AutomationsAnalytics } from '@fenwira/contracts'
import { type ColumnDef, DataTable, MetricCard, PermissionState, TrendChart } from '@fenwira/ui'
import { AlertTriangle, CheckCircle2, Hand, Workflow } from 'lucide-react'
import Link from 'next/link'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
import { BreakdownTable } from '@/components/analytics/breakdown-table'
import { useSession } from '@/components/session/session-provider'
import {
  count,
  countDelta,
  duration,
  percent,
  rateDelta,
  rateHint,
  shortDay,
  useAnalytics,
  useAnalyticsRange,
} from '@/lib/analytics'

type Flow = AutomationsAnalytics['flows'][number]

const columns: Array<ColumnDef<Flow>> = [
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
  {
    id: 'completed',
    header: 'Completed',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.completed),
  },
  {
    id: 'failed',
    header: 'Failed',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.failed),
  },
  {
    id: 'takeover',
    header: 'Stopped by takeover',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.stoppedByTakeover),
  },
  {
    id: 'success',
    header: 'Success rate',
    meta: { align: 'right' },
    cell: ({ row }) => percent(row.original.successRate),
  },
  {
    id: 'duration',
    header: 'Average duration',
    meta: { align: 'right' },
    cell: ({ row }) => duration(row.original.averageDurationSeconds),
  },
]

/** Analytics → Automations: executions by outcome, counted on the day they started. */
export default function AutomationAnalyticsPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<AutomationsAnalytics>('automations', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Automation analytics"
      description="How often your automations ran and how the runs ended."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          <KpiGrid>
            <MetricCard
              label="Runs"
              icon={<Workflow />}
              value={count(d.kpis.executions.value)}
              delta={countDelta(d.kpis.executions)}
              hint={`${count(d.kpis.inProgress)} still running or waiting`}
            />
            <MetricCard
              label="Success rate"
              icon={<CheckCircle2 />}
              value={percent(d.kpis.successRate.value)}
              delta={rateDelta(d.kpis.successRate)}
              hint={rateHint(d.kpis.successRate, 'finished runs completed')}
            />
            <MetricCard
              label="Failed"
              icon={<AlertTriangle />}
              value={count(d.kpis.failed.value)}
              delta={countDelta(d.kpis.failed, false)}
              hint={`${count(d.kpis.stepFailures.value)} failed steps · average run ${duration(d.kpis.averageDurationSeconds)}`}
            />
            <MetricCard
              label="Stopped by takeover"
              icon={<Hand />}
              value={count(d.kpis.stoppedByTakeover.value)}
              delta={countDelta(d.kpis.stoppedByTakeover)}
              hint={`${count(d.kpis.cancelled.value)} cancelled by a teammate`}
            />
          </KpiGrid>
          <Panel title="Runs per day by outcome">
            <TrendChart
              label="Automation runs per day by outcome"
              variant="stacked"
              data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
              series={[
                { key: 'completed', label: 'Completed', tone: 'success' },
                { key: 'failed', label: 'Failed', tone: 'danger' },
                { key: 'stoppedByTakeover', label: 'Stopped by takeover', tone: 'info' },
                { key: 'cancelled', label: 'Cancelled', tone: 'neutral' },
                { key: 'inProgress', label: 'Running or waiting', tone: 'warning' },
              ]}
            />
          </Panel>
          <Panel title="By automation">
            <DataTable
              label="Runs by automation"
              columns={columns}
              data={d.flows}
              getRowId={(f) => f.flowId}
              empty={{ title: 'No automation runs in this period.' }}
            />
          </Panel>
          <Panel title="Failed steps by type">
            <BreakdownTable
              label="Failed steps by type"
              dimension="Step"
              rows={d.stepFailuresByType}
              columns={[{ key: 'failed', label: 'Failures' }]}
              empty="No steps failed in this period."
            />
          </Panel>
        </>
      )}
    </AnalyticsFrame>
  )
}
