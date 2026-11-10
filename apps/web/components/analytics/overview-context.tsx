'use client'

import {
  type AnalyticsMeta,
  type InboxAnalytics,
  type MessagingAnalytics,
  type Rate,
} from '@fenwira/contracts'
import { type UseQueryResult } from '@tanstack/react-query'
import { ErrorState, Skeleton, cn, textLink } from '@fenwira/ui'
import Link from 'next/link'
import { type ReactNode } from 'react'
import { count, duration, percent } from '@/lib/analytics'
import { Notices, Panel } from './analytics-frame'

/** Additional overview sections retain their own endpoint's loading/freshness/error state. */
function QueryContent<T extends { meta: AnalyticsMeta }>({
  query,
  children,
}: {
  query: UseQueryResult<T>
  children: (data: T) => ReactNode
}) {
  if (query.isError)
    return (
      <ErrorState description="This summary couldn’t load." onRetry={() => void query.refetch()} />
    )
  if (!query.data || query.isPlaceholderData)
    return (
      <div role="status" aria-label="Loading summary">
        <Skeleton className="h-44" />
      </div>
    )
  if (query.data.meta.freshness.status === 'NOT_STARTED')
    return <p className="py-4 text-sm text-fg-secondary">Analytics are being prepared.</p>
  return (
    <>
      <Notices meta={query.data.meta} />
      {children(query.data)}
    </>
  )
}

/** One compact label/value row; `detail` states what the figure counts or its denominator. */
function Row({ label, value, detail }: { label: string; value: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <dt className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-xs text-fg-secondary">{detail}</span>
      </dt>
      <dd className="shrink-0 text-lg font-semibold text-fg tabular-nums">{value}</dd>
    </div>
  )
}

/** "96.8% of 28,492 sent", or why there is no rate. */
const rateOf = (r: Rate, of: string) =>
  r.denominator === 0
    ? `No ${of} messages in this period`
    : `${percent(r.value)} of ${count(r.denominator)} ${of}`

export function EngagementSummary({ query }: { query: UseQueryResult<MessagingAnalytics> }) {
  return (
    <Panel
      title="Engagement"
      description="Outbound messages by latest status, and customer replies."
      action={
        <Link href="/analytics/messaging" className={cn('text-sm font-medium', textLink)}>
          View messaging →
        </Link>
      }
    >
      <QueryContent query={query}>
        {(d) => (
          <dl className="divide-y divide-border-subtle">
            <Row
              label="Delivered"
              value={count(d.kpis.delivered.value)}
              detail={rateOf(d.kpis.deliveryRate, 'sent')}
            />
            <Row
              label="Read"
              value={count(d.kpis.read.value)}
              detail={rateOf(d.kpis.readRate, 'delivered')}
            />
            <Row
              label="Customer messages"
              value={count(d.kpis.inbound.value)}
              detail="Inbound messages received"
            />
            <Row
              label="Failed"
              value={count(d.kpis.failed.value)}
              detail={
                d.kpis.failureRate.denominator === 0
                  ? 'No messages sent or failed in this period'
                  : `${percent(d.kpis.failureRate.value)} of ${count(d.kpis.failureRate.denominator)} sent or failed`
              }
            />
          </dl>
        )}
      </QueryContent>
    </Panel>
  )
}

export function TeamSummary({ query }: { query: UseQueryResult<InboxAnalytics> }) {
  return (
    <Panel
      title="Team responsiveness"
      action={
        <Link href="/analytics/inbox" className={cn('text-sm font-medium', textLink)}>
          View team →
        </Link>
      }
    >
      <QueryContent query={query}>
        {(d) => (
          <div className="flex flex-col gap-3">
            <dl className="divide-y divide-border-subtle">
              <Row
                label="Median first reply"
                value={duration(d.kpis.medianFirstResponseSeconds)}
                detail={
                  d.kpis.firstResponses
                    ? `From ${count(d.kpis.firstResponses)} replies by teammates`
                    : 'No teammate replies in this period'
                }
              />
              <Row
                label="Awaiting first reply"
                value={count(d.kpis.awaitingFirstResponse)}
                detail="Opened in this period, no teammate reply yet"
              />
              <Row
                label="Unassigned"
                value={count(d.kpis.unassignedNow)}
                detail="Open conversations with no teammate · current snapshot"
              />
            </dl>
            <p className="text-xs text-fg-secondary">Human replies only.</p>
            {d.episodesSince && d.episodesSince > d.meta.range.from ? (
              <p className="text-xs text-fg-secondary">
                Response history starts on {d.episodesSince}.
              </p>
            ) : null}
          </div>
        )}
      </QueryContent>
    </Panel>
  )
}
