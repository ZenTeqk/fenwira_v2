'use client'
import { type BusinessHours, type ReplyReport } from '@fenwira/contracts'
import { Button, MetricCard, Skeleton, StatusBadge } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCheck, Handshake, MessageCircle, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { automationKey } from '@/lib/automation'
import { businessHoursLabel, metricChange } from '@/lib/reply-studio-presentation'
const METRICS = [
  { key: 'starts', label: 'Starts', icon: MessageCircle },
  { key: 'completions', label: 'Completed', icon: CheckCheck },
  { key: 'handovers', label: 'Handed over', icon: Handshake },
  { key: 'failures', label: 'Failed', icon: TriangleAlert },
] as const
export function ReplyOverview() {
  const { tenantId } = useSession()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  const period = useMemo(() => {
    const end = new Date()
    return {
      end: end.toISOString(),
      middle: new Date(end.getTime() - 7 * 86400000).toISOString(),
      start: new Date(end.getTime() - 14 * 86400000).toISOString(),
    }
  }, [tenantId])
  const totals = useQuery({
    queryKey: automationKey(tenantId, 'reply-overview', period.end),
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        get<{ data: ReplyReport }>(
          `/reply-studio/reports?${new URLSearchParams({ from: period.middle, to: period.end })}`,
        ),
        get<{ data: ReplyReport }>(
          `/reply-studio/reports?${new URLSearchParams({ from: period.start, to: period.middle })}`,
        ),
      ])
      return { current: current.data.totals, previous: previous.data.totals }
    },
  })
  const hours = useQuery({
    queryKey: automationKey(tenantId, 'business-hours'),
    queryFn: () => get<{ data: BusinessHours }>('/reply-studio/business-hours').then((r) => r.data),
  })
  const state = useMemo(
    () => (hours.data ? businessHoursLabel(hours.data, now) : null),
    [hours.data, now],
  )
  return (
    <section aria-label="Reply Studio overview" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-secondary">Last 7 days</h2>
          <span className="text-xs text-muted">vs previous 7 days</span>
        </div>
        <Link
          href="/automations/reply-studio/reports"
          className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary-strong"
        >
          View reports
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-4">
        {METRICS.map((m) => {
          const value = totals.data?.current[m.key],
            previous = totals.data?.previous[m.key]
          return (
            <Link
              key={m.key}
              href="/automations/reply-studio/reports"
              aria-label={`${m.label}: ${value ?? 'loading'}. View reports`}
              className="min-w-44 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
            >
              <MetricCard
                compact
                label={m.label}
                value={totals.isError ? '—' : (value?.toLocaleString('en-IN') ?? '—')}
                icon={<m.icon aria-hidden="true" />}
                loading={totals.isPending}
                hint={
                  value !== undefined && previous !== undefined
                    ? metricChange(value, previous)
                    : totals.isError
                      ? 'Reports unavailable'
                      : 'Compared with last week'
                }
                className="h-full border-border bg-surface p-4 shadow-none"
              />
            </Link>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {hours.isPending ? (
          <Skeleton className="h-8 w-60" />
        ) : (
          <Link
            href="/automations/reply-studio/business-hours"
            className="inline-flex min-h-9 flex-wrap items-center gap-2 rounded-full border border-border bg-surface px-4 py-1 text-xs text-secondary hover:border-border-strong focus-visible:outline-2 focus-visible:outline-primary-strong"
            aria-label={`Business hours: ${state ? (state.open ? 'Open now' : 'Closed') : 'View schedule'}`}
          >
            {state ? (
              <StatusBadge
                status={state.open ? 'ACTIVE' : 'INACTIVE'}
                label={state.open ? 'Open now' : 'Closed'}
              />
            ) : null}
            <span>{state ? `· ${state.detail}` : 'Business hours'}</span>
          </Link>
        )}
        <p className="text-xs text-muted">A little setup. A lot less repetitive work.</p>
      </div>
      {totals.isError ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => void totals.refetch()}
        >
          Retry overview
        </Button>
      ) : null}
    </section>
  )
}
