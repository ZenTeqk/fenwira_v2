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
  Timeline,
  focusRing,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, Workflow, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { displayName, shortTime } from '@/lib/inbox'
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
      <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border px-5 py-4">
        <CardTitle as="h2">Recent conversations</CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/inbox">Open inbox</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-3">
        {conversations.isPending ? (
          <Skeleton className="h-40" />
        ) : conversations.isError ? (
          <ErrorState
            title="Conversations couldn’t be loaded"
            onRetry={() => void conversations.refetch()}
          />
        ) : conversations.data.length ? (
          <ul className="divide-y divide-border" aria-label="Recent conversations">
            {conversations.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/inbox?c=${c.id}`}
                  className={`flex min-w-0 items-center gap-3 rounded-md py-3 hover:bg-neutral-soft ${focusRing}`}
                >
                  <Avatar name={displayName(c)} size="lg" appearance="varied" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-semibold text-slate">{displayName(c)}</span>
                    <span className="truncate text-sm text-secondary">
                      {c.lastMessagePreview ?? 'No messages yet'}
                    </span>
                    <span className="text-xs text-muted">
                      {c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned'}
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
  const active = (campaigns ?? []).filter((c) =>
    [
      'RUNNING',
      'SCHEDULED',
      'PAUSED',
      'PAUSED_INSUFFICIENT_FUNDS',
      'PAUSED_TEMPLATE_UNAVAILABLE',
    ].includes(c.status),
  )
  const recent = [...(active.length ? active : (campaigns ?? []))]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border px-5 py-4">
        <CardTitle as="h2">{active.length ? 'Active campaigns' : 'Campaign activity'}</CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/campaigns">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-3">
        {error ? (
          <ErrorState title="Campaigns couldn’t be loaded" onRetry={retry} />
        ) : !campaigns ? (
          <Skeleton className="h-40" />
        ) : (
          <Timeline
            appearance="activity"
            label="Current campaign activity"
            empty="No campaigns yet. Campaign status and audience will appear here."
            items={recent.map((c) => ({
              id: c.id,
              icon: <Megaphone />,
              title: (
                <Link
                  href={`/campaigns/${c.id}`}
                  className={`underline-offset-4 hover:underline ${focusRing}`}
                >
                  {c.name}
                </Link>
              ),
              status: c.status,
              time: `Updated ${relativeTime(c.updatedAt)}`,
              description: `${c.totalRecipients.toLocaleString('en-IN')} recipients${c.pauseReason ? ` · ${c.pauseReason.toLowerCase().replaceAll('_', ' ')}` : ''}`,
            }))}
          />
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
      <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border px-5 py-4">
        <CardTitle as="h2">Automation activity</CardTitle>
        <Button variant="link" size="sm" asChild>
          <Link href="/automations">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-3">
        {flows.isPending ? (
          <Skeleton className="h-20" />
        ) : flows.isError ? (
          <ErrorState title="Automations couldn’t be loaded" onRetry={() => void flows.refetch()} />
        ) : (
          <Timeline
            appearance="activity"
            label="Current automation activity"
            empty="No automations yet. Published flows and their real run counts appear here."
            items={recent.map((f) => ({
              id: f.id,
              icon: <Workflow />,
              title: (
                <Link
                  href={`/automations/${f.id}`}
                  className={`underline-offset-4 hover:underline ${focusRing}`}
                >
                  {f.name}
                </Link>
              ),
              status: f.status,
              time: `Updated ${relativeTime(f.updatedAt)}`,
              description: `${f.executions.running} running · ${f.executions.total} total runs`,
              details: (
                <Link
                  href={`/automations/${f.id}/history`}
                  className="text-primary-strong underline"
                >
                  View run history
                </Link>
              ),
            }))}
          />
        )}
      </CardContent>
    </Card>
  )
}
