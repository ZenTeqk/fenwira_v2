'use client'

import { type AnalyticsMeta } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FilterBar,
  Input,
  Label,
  ModuleTabs,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@fenwira/ui'
import { type UseQueryResult } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/components/session/session-provider'
import { moduleTabs, visibleNavigation } from '@/lib/navigation'
import { type ReactNode, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { type AnalyticsRange, shortDay } from '@/lib/analytics'

const PRESETS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom dates' },
]

/** Date range control: presets or two workspace-local dates. */
export function RangePicker({
  range,
  onChange,
  today,
}: {
  range: AnalyticsRange
  onChange: (r: AnalyticsRange) => void
  today?: string
}) {
  const [draft, setDraft] = useState({
    from: range.kind === 'custom' ? range.from : '',
    to: range.kind === 'custom' ? range.to : (today ?? ''),
  })
  const value = range.kind === 'preset' ? String(range.days) : 'custom'
  return (
    <FilterBar label="Date range">
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === 'custom') {
            const to = draft.to || today || ''
            const from = draft.from || to
            if (from && to) onChange({ kind: 'custom', from, to })
          } else onChange({ kind: 'preset', days: Number(v) as 1 | 7 | 30 | 90 })
        }}
      >
        <SelectTrigger aria-label="Date range" className="h-9 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {range.kind === 'custom' ? (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor="range-from" className="text-sm text-fg-secondary">
              From
            </Label>
            <Input
              id="range-from"
              type="date"
              className="h-9 w-40"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setDraft((d) => ({ ...d, from: e.target.value }))
                if (e.target.value) onChange({ ...range, from: e.target.value })
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="range-to" className="text-sm text-fg-secondary">
              To
            </Label>
            <Input
              id="range-to"
              type="date"
              className="h-9 w-40"
              value={range.to}
              min={range.from}
              max={today}
              onChange={(e) => {
                setDraft((d) => ({ ...d, to: e.target.value }))
                if (e.target.value) onChange({ ...range, to: e.target.value })
              }}
            />
          </div>
        </>
      ) : null}
    </FilterBar>
  )
}

/** Freshness, retention and partial-day notices, so "0" is never confused with "not available". */
export function Notices({ meta }: { meta: AnalyticsMeta }) {
  const notes: ReactNode[] = []
  if (meta.freshness.status === 'DEGRADED')
    notes.push(
      <Alert key="degraded" tone="warning" title="Analytics couldn’t be updated">
        Figures may be out of date. Messages, campaigns and billing are not affected; we retry
        automatically.
      </Alert>,
    )
  else if (meta.freshness.status === 'PROCESSING')
    notes.push(
      <Alert key="processing" tone="info" title="Recent activity is still being processed">
        Figures update within a couple of minutes.
      </Alert>,
    )
  if (meta.retention.clamped)
    notes.push(
      <Alert key="retention" tone="info" title="Earlier history isn’t available">
        This workspace keeps {meta.retention.days} days of analytics, so the range starts on{' '}
        {shortDay(meta.range.from)}.
      </Alert>,
    )
  return notes.length ? <div className="flex flex-col gap-2">{notes}</div> : null
}

/**
 * The shared analytics structure (UX_PATTERNS → Analytics): header with the date range →
 * notices → KPIs → one primary visualization → breakdowns → detail table. Handles loading,
 * errors and "no analytics yet"; each view renders its content from `data`.
 */
export function AnalyticsFrame<T extends { meta: AnalyticsMeta }>({
  title,
  description,
  range,
  onRangeChange,
  query,
  children,
}: {
  title: string
  description: string
  range: AnalyticsRange
  onRangeChange: (r: AnalyticsRange) => void
  query: UseQueryResult<T>
  children: (data: T) => ReactNode
}) {
  const data = query.data
  const pathname = usePathname()
  const { membership } = useSession()
  const { tabs } = moduleTabs(pathname, visibleNavigation(false, undefined, membership.permissions))
  return (
    <div data-pattern="analytics" className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={title}
        description={description}
        className="[&>div>div]:max-w-full"
        actions={<RangePicker range={range} onChange={onRangeChange} today={data?.meta.today} />}
      />
      <ModuleTabs
        items={tabs}
        label="Analytics pages"
        linkAs={Link}
        className="bg-transparent [&_ul]:px-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data ? (
          <p className="text-sm text-fg-muted">
            {shortDay(data.meta.range.from)} – {shortDay(data.meta.range.to)}
            {data.meta.partial ? ' (today so far)' : ''} · {data.meta.timezone}
            {data.meta.previous ? ' · compared with the previous period' : ''}
          </p>
        ) : null}
      </div>
      {query.isError && !data ? (
        <Card>
          <ErrorState
            description={
              query.error instanceof ApiError ? query.error.message : 'Analytics couldn’t load.'
            }
            correlationId={query.error instanceof ApiError ? query.error.correlationId : undefined}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : !data || query.isPlaceholderData ? (
        <div
          className="flex flex-col gap-4"
          role="status"
          aria-busy="true"
          aria-label="Loading analytics"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : data.meta.freshness.status === 'NOT_STARTED' ? (
        <Card>
          <EmptyState
            icon={<BarChart3 aria-hidden="true" />}
            title="Analytics are being prepared"
            description="Figures appear a few minutes after the first activity in this workspace."
          />
        </Card>
      ) : (
        <>
          {query.isError ? (
            <Alert
              tone="warning"
              title="Latest figures couldn’t load"
              action={
                <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              }
            >
              Showing the last available figures for this range.
            </Alert>
          ) : null}
          <Notices meta={data.meta} />
          {children(data)}
        </>
      )}
    </div>
  )
}

/** A titled card for the primary chart or a breakdown. */
export function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">{title}</CardTitle>
          {action}
        </div>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-4 pt-0">{children}</CardContent>
    </Card>
  )
}

export const KpiGrid = ({ children }: { children: ReactNode }) => (
  <section
    aria-label="Key metrics"
    className="grid grid-cols-1 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 sm:[&>div+div]:border-l sm:[&>div+div]:border-border-subtle"
  >
    {children}
  </section>
)
