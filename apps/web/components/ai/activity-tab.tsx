'use client'

import {
  EmptyState,
  ErrorState,
  PermissionState,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { History } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { useAiActivity } from '@/lib/ai'
import { relativeTime } from '@/lib/relative-time'

/** Activity: the latest AI attempts for review (kept for the retention period). */
export function ActivityTab() {
  const { can } = useSession()
  const allowed = can('inbox.read_all')
  const list = useAiActivity(allowed)
  if (!allowed) return <PermissionState what="AI activity" permission="inbox.read_all" />
  if (list.isLoading) return <Skeleton className="h-64" />
  if (list.isError) return <ErrorState onRetry={() => list.refetch()} />
  if (!list.data?.length)
    return (
      <EmptyState
        icon={<History aria-hidden="true" />}
        title="No AI replies yet"
        description="Every answer the assistant gives, or hands over, appears here so you can review it."
      />
    )
  return (
    <Table aria-label="Recent AI replies">
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Customer asked</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Sources</TableHead>
          <TableHead>
            <span className="sr-only">Conversation</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.data.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap text-secondary">
              <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
                {relativeTime(r.createdAt)}
              </time>
            </TableCell>
            <TableCell className="max-w-sm">
              <p className="line-clamp-2 text-slate">{r.customerExcerpt}</p>
              {r.playground ? <p className="text-xs text-secondary">Test question</p> : null}
            </TableCell>
            <TableCell>
              <StatusBadge status={r.outcome} />
            </TableCell>
            <TableCell className="max-w-56 text-secondary">
              {r.sources.length
                ? [...new Set(r.sources.map((s) => s.documentTitle))].join(', ')
                : '—'}
            </TableCell>
            <TableCell className="text-right">
              {r.conversationId ? (
                <Link
                  href={`/inbox?c=${r.conversationId}`}
                  className="whitespace-nowrap font-medium text-primary-strong underline-offset-4 hover:underline"
                >
                  Open conversation
                </Link>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
