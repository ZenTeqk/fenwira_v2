'use client'
import { type BusinessHours, type ReplyReport } from '@fenwira/contracts'
import { Button, Skeleton, StatusBadge } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { Clock3, Handshake, MessageCircle, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { automationKey } from '@/lib/automation'
import { businessHoursLabel, metricChange } from '@/lib/reply-studio-presentation'
const METRICS = [
  { key: 'starts', label: 'Starts', icon: MessageCircle },
  { key: 'handovers', label: 'Handed over', icon: Handshake },
  { key: 'failures', label: 'Failed', icon: TriangleAlert },
] as const
export function BusinessHoursAction() {
  const { tenantId } = useSession()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  const hours = useQuery({
    queryKey: automationKey(tenantId, 'business-hours'),
    queryFn: () => get<{ data: BusinessHours }>('/reply-studio/business-hours').then((r) => r.data),
  })
  const state = useMemo(
    () => (hours.data ? businessHoursLabel(hours.data, now) : null),
    [hours.data, now],
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="secondary" size="sm">
        <Link href="/automations/reply-studio/business-hours">
          <Clock3 aria-hidden="true" />
          Business hours
        </Link>
      </Button>
      {hours.isPending ? (
        <Skeleton className="h-6 w-40" />
      ) : state ? (
        <span className="flex items-center gap-2 text-xs text-secondary">
          <StatusBadge
            status={state.open ? 'ACTIVE' : 'INACTIVE'}
            label={state.open ? 'Open now' : 'Closed'}
          />
          <span>· {state.detail}</span>
        </span>
      ) : (
        <span className="text-xs text-muted">Schedule unavailable</span>
      )}
    </div>
  )
}
export function ReplyOverview({ liveCount = 0 }: { liveCount?: number }) {
  const { tenantId } = useSession()
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
  return (
    <section
      aria-label="Reply Studio overview"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="grid grid-cols-2 gap-y-4 divide-x divide-border py-3 lg:grid-cols-4">
        <div className="flex min-w-0 items-center px-4">
          <StatusBadge status="ACTIVE" label={`${liveCount} replies live`} />
        </div>
        {METRICS.map((m) => {
          const value = totals.data?.current[m.key],
            previous = totals.data?.previous[m.key]
          return (
            <Link
              key={m.key}
              href="/automations/reply-studio/reports"
              aria-label={`${m.label}: ${value ?? 'loading'}. View reports`}
              className="flex min-w-0 items-center gap-3 px-4 focus-visible:outline-2 focus-visible:outline-primary-strong"
            >
              <m.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <div
                className="flex flex-wrap items-center gap-x-2"
                title={
                  value !== undefined && previous !== undefined
                    ? metricChange(value, previous)
                    : undefined
                }
              >
                <p className="order-2 text-sm text-secondary">
                  {m.label} <span className="text-muted">· 7 days</span>
                </p>
                <p className="text-sm font-semibold text-slate">
                  {totals.isPending ? '…' : totals.isError ? '—' : value?.toLocaleString('en-IN')}
                </p>
                <p className="sr-only">
                  {value !== undefined && previous !== undefined
                    ? metricChange(value, previous)
                    : totals.isError
                      ? 'Reports unavailable'
                      : 'Loading activity'}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
      {totals.isError ? (
        <Button variant="ghost" size="sm" onClick={() => void totals.refetch()}>
          Retry overview
        </Button>
      ) : null}
    </section>
  )
}
