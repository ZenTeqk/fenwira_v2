'use client'

import { type Campaign, type Conversation, type Flow } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
  StatusBadge,
  Progress,
  focusRing,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, Workflow, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { displayName, shortTime } from '@/lib/inbox'
import { useCampaignStats, percent, ACTIVE_STATUSES } from '@/lib/campaigns'
import { relativeTime } from '@/lib/relative-time'

export function RecentConversations() {
  const { tenantId } = useSession()
  const conversations = useQuery({
    queryKey: keys.tenant(tenantId, 'dashboard', 'recent-conversations'),
    queryFn: () =>
      get<{ data: Conversation[] }>('/conversations?view=all&limit=5').then((r) => r.data),
    refetchInterval: 30_000,
  })
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border px-5 py-3">
        <CardTitle as="h2" className="text-lg">
          Recent conversations
        </CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/inbox">Open inbox</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        {conversations.isPending ? (
          <Skeleton className="h-40" />
        ) : conversations.isError ? (
          <ErrorState
            title="Conversations couldn’t be loaded"
            onRetry={() => void conversations.refetch()}
          />
        ) : conversations.data.length ? (
          <ul className="divide-y divide-border" aria-label="Recent conversations">
            {conversations.data.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/inbox?c=${c.id}`}
                  className={`flex min-w-0 items-center gap-3 rounded-md py-2.5 hover:bg-neutral-soft ${focusRing}`}
                >
                  <Avatar name={displayName(c)} size="lg" appearance="varied" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-md font-semibold text-slate">
                      {displayName(c)}
                    </span>
                    <span className="truncate text-base text-secondary">
                      {c.lastMessagePreview ?? 'No messages yet'}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-xs text-muted">{shortTime(c.lastMessageAt)}</span>
                    {c.unreadCount ? (
                      <span className="rounded-full bg-primary-strong px-2 text-xs text-surface">
                        {c.unreadCount}
                        <span className="sr-only"> unread</span>
                      </span>
                    ) : (
                      <StatusBadge status={c.status} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-2 py-4 text-sm text-secondary">
            <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
            New customer conversations will appear here.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Current states and update times, not a fabricated historical event stream. */
export function CampaignActivity({
  campaigns,
  error,
  retry,
}: {
  campaigns?: Campaign[]
  error: boolean
  retry: () => void
}) {
  const { tenantId, can } = useSession()
  const conversations = useQuery({
    queryKey: keys.tenant(tenantId, 'dashboard', 'recent-conversations'),
    queryFn: () =>
      get<{ data: Conversation[] }>('/conversations?view=all&limit=5').then((r) => r.data),
    enabled: can('inbox.read'),
    refetchInterval: 30_000,
  })
  const flows = useQuery({
    queryKey: keys.tenant(tenantId, 'automation', 'flows'),
    queryFn: () => get<{ data: Flow[] }>('/flows').then((r) => r.data),
    enabled: can('automations.read'),
    refetchInterval: 30_000,
  })
  const updates = [
    ...(campaigns ?? []).slice(0, 2).map((c) => ({
      id: c.id,
      name: c.name,
      time: c.updatedAt,
      label: 'Campaign updated',
      status: c.status,
      Icon: Megaphone,
      tone: 'bg-primary-soft text-primary-strong',
    })),
    ...(can('automations.read') ? (flows.data ?? []) : []).slice(0, 1).map((f) => ({
      id: f.id,
      name: f.name,
      time: f.updatedAt,
      label: 'Automation updated',
      status: f.status,
      Icon: Workflow,
      tone: 'bg-warning-soft text-warning-strong',
    })),
    ...(can('inbox.read') ? (conversations.data ?? []) : [])
      .filter((c) => c.lastMessageAt !== null)
      .slice(0, 2)
      .map((c) => ({
        id: c.id,
        name: displayName(c),
        time: c.lastMessageAt!,
        label: 'Message',
        status: c.status,
        Icon: MessageSquare,
        tone: 'bg-info-soft text-info-strong',
      })),
  ]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 4)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 px-5 py-3">
        <CardTitle as="h2" className="text-lg">
          Activity
        </CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/campaigns">View campaigns</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="mb-4 text-xs text-muted">Current workspace updates</p>
        {error || conversations.isError || flows.isError ? (
          <ErrorState
            title="Some updates couldn’t be loaded"
            onRetry={() => {
              retry()
              if (can('inbox.read')) void conversations.refetch()
              if (can('automations.read')) void flows.refetch()
            }}
          />
        ) : null}
        {!campaigns ? (
          <Skeleton className="h-40" />
        ) : updates.length ? (
          <ol aria-label="Current workspace updates" className="flex flex-col gap-4">
            {updates.map(({ id, name, time, label, status, Icon, tone }, i) => (
              <li key={id} className="relative flex items-start gap-3">
                {i < updates.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-10 -bottom-4 left-5 w-px bg-border"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={`relative flex size-10 shrink-0 items-center justify-center rounded-full ${tone}`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate">{name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">
                      {label} · {relativeTime(time)}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-3 text-sm text-secondary">No workspace updates yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

export function AutomationActivity() {
  const { tenantId } = useSession()
  const flows = useQuery({
    queryKey: keys.tenant(tenantId, 'automation', 'flows'),
    queryFn: () => get<{ data: Flow[] }>('/flows').then((r) => r.data),
    refetchInterval: 30_000,
  })
  const recent = [...(flows.data ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 px-5 py-3">
        <CardTitle as="h2" className="text-lg">
          Automation activity
        </CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/automations">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {flows.isPending ? (
          <Skeleton className="h-20" />
        ) : flows.isError ? (
          <ErrorState title="Automations couldn’t be loaded" onRetry={() => void flows.refetch()} />
        ) : recent.length ? (
          <ul className="flex flex-col gap-4" aria-label="Current automation activity">
            {recent.map((f) => (
              <li key={f.id} className="flex min-w-0 flex-wrap items-center gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
                  <Workflow className="size-6" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/automations/${f.id}`}
                      className={`text-md font-semibold text-slate hover:underline ${focusRing}`}
                    >
                      {f.name}
                    </Link>
                    <StatusBadge status={f.status} />
                  </div>
                  <p className="mt-1 text-sm text-secondary">
                    {f.executions.running} running · {f.executions.total} total runs
                  </p>
                  <Link
                    href={`/automations/${f.id}/history`}
                    className={`mt-2 inline-flex text-sm text-primary-strong hover:underline ${focusRing}`}
                  >
                    View run history
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-secondary">
            No automations yet. Published flows and their real run counts appear here.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Distinct operational summary. Drafts have no delivery denominator; never draw fictional progress. */
export function CampaignSnapshot({
  campaigns,
  error,
  retry,
}: {
  campaigns?: Campaign[]
  error: boolean
  retry: () => void
}) {
  const sorted = [...(campaigns ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const campaign =
    sorted.find((c) => ACTIVE_STATUSES.includes(c.status) || c.status.startsWith('PAUSED')) ??
    sorted[0]
  const stats = useCampaignStats(
    campaign?.id ?? '',
    Boolean(campaign && ACTIVE_STATUSES.includes(campaign.status)),
    Boolean(campaign?.audienceSnapshotAt),
  )
  const data = stats.data
  const sent = data ? data.sent : undefined
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 px-5 py-3">
        <CardTitle as="h2" className="min-w-0 truncate text-lg">
          {campaign ? (
            <Link href={`/campaigns/${campaign.id}`} className={`hover:underline ${focusRing}`}>
              {campaign.name}
            </Link>
          ) : (
            'Campaign overview'
          )}
        </CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href={campaign ? `/campaigns/${campaign.id}` : '/campaigns'}>
            {campaign ? 'View campaign' : 'View all'}
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        {error ? (
          <ErrorState title="Campaigns couldn’t be loaded" onRetry={retry} />
        ) : !campaigns ? (
          <Skeleton className="h-24" />
        ) : !campaign ? (
          <p className="py-3 text-secondary">
            No campaigns yet. Your next customer update will appear here.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={campaign.status} />
              <span className="text-base text-secondary">
                {sent === undefined
                  ? `${campaign.totalRecipients.toLocaleString('en-IN')} recipients`
                  : `${sent.toLocaleString('en-IN')} / ${data!.total.toLocaleString('en-IN')} sent`}
              </span>
            </div>
            {data && data.total > 0 && sent !== undefined ? (
              <Progress
                className="mt-3"
                value={sent}
                max={data.total}
                label="Campaign messages sent"
              />
            ) : null}
            {stats.isError ? (
              <ErrorState
                title="Campaign results couldn’t be loaded"
                onRetry={() => void stats.refetch()}
              />
            ) : null}
            <dl className="mt-3 grid grid-cols-3 divide-x divide-border border-t border-border pt-2">
              <div className="pr-3">
                <dt className="text-sm text-secondary">Delivered</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {data ? percent(data.deliveryRate) : '—'}
                </dd>
              </div>
              <div className="px-3">
                <dt className="text-sm text-secondary">Read</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {data ? percent(data.readRate) : '—'}
                </dd>
              </div>
              <div className="pl-3">
                <dt className="text-sm text-secondary">Started</dt>
                <dd className="mt-1 text-md font-semibold">
                  {campaign.startedAt ? shortTime(campaign.startedAt) : 'Not started'}
                </dd>
              </div>
            </dl>
            {!campaign.audienceSnapshotAt ? (
              <p className="mt-2 text-xs text-muted">
                Delivery results become available after launch.
              </p>
            ) : stats.isPending ? (
              <p role="status" className="mt-2 text-xs text-muted">
                Loading delivery results…
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
