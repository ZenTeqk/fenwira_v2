'use client'

import { type ContactActivity, type Message } from '@fenwira/contracts'
import { Button, Skeleton, Timeline } from '@fenwira/ui'
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Hand, StickyNote, Tag, UserRound } from 'lucide-react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { formatDateTime } from '@/lib/contacts'
import { activityWatermark, customerActivity } from '@/lib/customer-panel'
import { relativeTime } from '@/lib/relative-time'
import { CustomerPanelError } from './contact-details'
import { threadKey } from './thread'

type Page<T> = { data: T[]; page: { nextCursor: string | null } }
const ICON = { assignment: UserRound, tag: Tag, note: StickyNote, automation: Hand }

/** Independent cursors preserve the chat's own pagination/scroll anchor. Reuse its authorized
 * initial cache, then page the right-panel history without modifying the chat cache. */
export function CustomerActivity({
  contactId,
  conversationId,
}: {
  contactId: string
  conversationId: string
}) {
  const { tenantId } = useSession()
  const client = useQueryClient()
  const base = keys.tenant(tenantId, 'contact', contactId, 'inbox-activity', conversationId)
  const contact = useInfiniteQuery({
    queryKey: [...base, 'contact'],
    queryFn: ({ pageParam }) =>
      get<Page<ContactActivity>>(
        `/contacts/${contactId}/activities${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  })
  const messages = useInfiniteQuery({
    queryKey: [...base, 'messages'],
    queryFn: ({ pageParam }) =>
      get<Page<Message>>(
        `/conversations/${conversationId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    initialData: () =>
      client.getQueryData<InfiniteData<Page<Message>, string>>(threadKey(tenantId, conversationId)),
    initialDataUpdatedAt: () =>
      client.getQueryState(threadKey(tenantId, conversationId))?.dataUpdatedAt,
    refetchOnWindowFocus: true,
  })
  const contacts = contact.data?.pages.flatMap((page) => page.data) ?? []
  const history = messages.data?.pages.flatMap((page) => page.data) ?? []
  const hasMore = contact.hasNextPage || messages.hasNextPage
  const since = activityWatermark(
    contacts.map((event) => event.occurredAt),
    !!contact.hasNextPage,
    history.map((message) => message.createdAt),
    !!messages.hasNextPage,
  )
  const events = customerActivity(contacts, history, since)
  if (contact.isPending || messages.isPending) return <Skeleton className="h-32" />
  if (contact.isError || messages.isError)
    return (
      <CustomerPanelError
        title="Activity couldn’t be loaded"
        onRetry={() => {
          void contact.refetch()
          void messages.refetch()
        }}
      />
    )
  return (
    <section aria-label="Customer activity" className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-fg-secondary">Newest first</p>
      <Timeline
        label="Customer activity"
        className="fw-inbox-customer-activity text-base"
        empty={hasMore ? 'No events in this part of the history.' : 'No activity yet.'}
        items={events.map((event) => {
          const Icon = ICON[event.kind]
          return {
            id: event.id,
            title: event.text,
            icon: <Icon aria-hidden="true" />,
            description: event.actor,
            time: (
              <time dateTime={event.at} title={formatDateTime(event.at)}>
                {relativeTime(event.at)}
              </time>
            ),
          }
        })}
      />
      {hasMore ? (
        <Button
          size="sm"
          variant="secondary"
          className="h-8 self-start text-xs"
          loading={contact.isFetchingNextPage || messages.isFetchingNextPage}
          onClick={() => {
            if (contact.hasNextPage) void contact.fetchNextPage()
            if (messages.hasNextPage) void messages.fetchNextPage()
          }}
        >
          Load earlier activity
        </Button>
      ) : null}
    </section>
  )
}
