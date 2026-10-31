'use client'

import {
  type AnalyticsMeta,
  type InboxAnalytics,
  type MessagingAnalytics,
} from '@fenwira/contracts'
import { type UseQueryResult } from '@tanstack/react-query'
import { ErrorState, Skeleton, cn, textLink } from '@fenwira/ui'
import { CheckCheck, Clock, Eye, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode } from 'react'
import { count, duration, percent, rateHint } from '@/lib/analytics'
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
        <Skeleton className="h-48" />
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

export function EngagementSummary({ query }: { query: UseQueryResult<MessagingAnalytics> }) {
  return (
    <Panel title="Customer engagement" description="Delivery and reading of outbound messages.">
      <QueryContent query={query}>
        {(d) => (
          <div className="divide-y divide-border-subtle">
            {[
              {
                label: 'Delivery rate',
                icon: CheckCheck,
                rate: d.kpis.deliveryRate,
                hint: 'sent messages delivered',
                bar: 'bg-chart-stage-2',
              },
              {
                label: 'Read rate',
                icon: Eye,
                rate: d.kpis.readRate,
                hint: 'delivered messages read',
                bar: 'bg-chart-stage-3',
              },
            ].map(({ label, icon: Icon, rate, hint, bar }) => (
              <div key={label} className="flex items-start gap-3 py-4">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-secondary"
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{label}</p>
                    <strong className="text-lg tabular-nums">{percent(rate.value)}</strong>
                  </div>
                  {rate.value !== null ? (
                    <div
                      aria-hidden="true"
                      className="h-2 overflow-hidden rounded-full bg-surface-muted"
                    >
                      <div
                        className={cn('h-full rounded-full', bar)}
                        style={{ width: `${Math.max(0, Math.min(100, rate.value * 100))}%` }}
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-fg-secondary">{rateHint(rate, hint)}</p>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-3 py-4">
              <MessageSquare aria-hidden="true" className="size-5 text-accent-conversation-fg" />
              <div>
                <p className="text-sm font-medium">Messages from customers</p>
                <p className="text-xl font-semibold tabular-nums">{count(d.kpis.inbound.value)}</p>
                <p className="text-xs text-fg-secondary">All inbound messages in this period.</p>
              </div>
            </div>
          </div>
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
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-accent-conversation-bg text-accent-conversation-fg"
              >
                <Clock className="size-5" />
              </span>
              <div>
                <p className="text-sm text-fg-secondary">Median first reply</p>
                <p className="text-xl font-semibold tabular-nums">
                  {duration(d.kpis.medianFirstResponseSeconds)}
                </p>
              </div>
            </div>
            <p className="text-xs text-fg-secondary">
              {d.kpis.firstResponses
                ? `From ${count(d.kpis.firstResponses)} replies by teammates`
                : 'No teammate replies in this period'}
            </p>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border-subtle p-3">
                <dt className="text-xs text-fg-secondary">Open now</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{count(d.kpis.openNow)}</dd>
              </div>
              <div className="rounded-md border border-border-subtle p-3">
                <dt className="text-xs text-fg-secondary">Awaiting first reply</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {count(d.kpis.awaitingFirstResponse)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-fg-secondary">
              Human replies only. Open and awaiting counts reflect the current inbox.
            </p>
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
