'use client'

import { type InboxAnalytics } from '@fenwira/contracts'
import {
  Alert,
  type ColumnDef,
  DataTable,
  MetricCard,
  PermissionState,
  TrendChart,
} from '@fenwira/ui'
import { CheckCircle2, Clock, MessageSquarePlus, UserX } from 'lucide-react'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
import { useSession } from '@/components/session/session-provider'
import {
  count,
  countDelta,
  duration,
  shortDay,
  useAnalytics,
  useAnalyticsRange,
} from '@/lib/analytics'

type Agent = InboxAnalytics['agents'][number]

const columns: Array<ColumnDef<Agent>> = [
  { id: 'name', header: 'Teammate', cell: ({ row }) => row.original.name },
  {
    id: 'open',
    header: 'Open now',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.assignedOpenNow),
  },
  {
    id: 'assigned',
    header: 'Assigned',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.assigned),
  },
  {
    id: 'responses',
    header: 'First replies',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.firstResponses),
  },
  {
    id: 'frt',
    header: 'Median first reply',
    meta: { align: 'right' },
    cell: ({ row }) => duration(row.original.medianFirstResponseSeconds),
  },
  {
    id: 'resolved',
    header: 'Resolved',
    meta: { align: 'right' },
    cell: ({ row }) => count(row.original.resolved),
  },
]

/**
 * Analytics → Inbox. Only metrics derivable from recorded events and message history: see
 * docs/ANALYTICS.md → Inbox for the exact definitions (calendar time, human replies only, each
 * reopen is a new episode).
 */
export default function InboxAnalyticsPage() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<InboxAnalytics>('inbox', range, can('analytics.read'))
  if (!can('analytics.read'))
    return <PermissionState what="analytics" permission="analytics.read" />
  return (
    <AnalyticsFrame
      title="Inbox analytics"
      description="Conversations customers opened and how quickly your team answered them."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => (
        <>
          {d.episodesSince && d.episodesSince > d.meta.range.from ? (
            <Alert tone="info" title="Response times start later">
              Customer-opened conversations are recorded from {shortDay(d.episodesSince)}, when
              analytics started for this workspace.
            </Alert>
          ) : null}
          <KpiGrid>
            <MetricCard
              appearance="analytics"
              label="Conversations opened"
              icon={<MessageSquarePlus />}
              value={count(d.kpis.opened.value)}
              delta={countDelta(d.kpis.opened)}
              hint={`${count(d.kpis.newConversations.value)} new conversations`}
            />
            <MetricCard
              appearance="analytics"
              label="Median first reply"
              icon={<Clock />}
              value={duration(d.kpis.medianFirstResponseSeconds)}
              hint={
                d.kpis.firstResponses
                  ? `From ${count(d.kpis.firstResponses)} replies by teammates`
                  : 'No teammate replies in this period'
              }
            />
            <MetricCard
              appearance="analytics"
              label="Resolved"
              icon={<CheckCircle2 />}
              value={count(d.kpis.resolved.value)}
              delta={countDelta(d.kpis.resolved)}
              hint={`Median time to resolve: ${duration(d.kpis.medianResolutionSeconds)}`}
            />
            <MetricCard
              appearance="analytics"
              label="Unassigned now"
              icon={<UserX />}
              value={count(d.kpis.unassignedNow)}
              hint={`${count(d.kpis.openNow)} open · ${count(d.kpis.awaitingFirstResponse)} awaiting a first reply`}
            />
          </KpiGrid>
          <Panel title="Conversations per day">
            <TrendChart
              label="Conversations per day"
              variant="bar"
              data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
              series={[
                { key: 'opened', label: 'Opened by customers', tone: 'blue' },
                { key: 'resolved', label: 'Resolved', tone: 'good' },
              ]}
            />
          </Panel>
          <Panel
            title="Team"
            description="Replies and resolutions in this period; open and assigned right now."
          >
            <DataTable
              label="Team workload"
              columns={columns}
              data={d.agents}
              getRowId={(a) => a.userId}
              empty={{ title: 'No conversations were assigned, answered or resolved.' }}
            />
          </Panel>
        </>
      )}
    </AnalyticsFrame>
  )
}
