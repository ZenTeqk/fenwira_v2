'use client'

import { type Conversation, type ConversationCounts } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  ErrorState,
  focusRing,
  Label,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from '@fenwira/ui'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { displayName, shortTime } from '@/lib/inbox'
import { useRealtimeEvent, useRealtimeReconnect } from '@/lib/realtime'
import { STATUS_LABEL } from './conversation-actions'
import { type AdvancedFilter, InboxFilterMenu, INBOX_VIEWS, type InboxView } from './inbox-views'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

type Page = { data: Conversation[]; page: { nextCursor: string | null } }
/** No status = the views' default (open and waiting); any choice replaces it. */
const STATUS_OPTIONS = ['DEFAULT', 'OPEN', 'PENDING', 'SNOOZED', 'RESOLVED'] as const
type StatusChoice = (typeof STATUS_OPTIONS)[number]
const PAGE_SIZE = 30

function ConversationRow({
  c,
  selected,
  onSelect,
}: {
  c: Conversation
  selected: boolean
  onSelect: () => void
}) {
  const name = displayName(c)
  const context = [
    c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned',
    c.automationState === 'AGENT_TAKEOVER' ? 'Agent takeover' : null,
    c.status !== 'OPEN' ? STATUS_LABEL[c.status] : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={context}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-3 border-b border-l-3 border-b-border py-3.5 pr-4 pl-4.25 text-left transition-colors',
          focusRing,
          'focus-visible:-outline-offset-2',
          selected
            ? 'border-l-primary bg-primary-soft'
            : 'border-l-transparent hover:bg-neutral-soft',
        )}
      >
        <Avatar appearance="varied" name={name} size="lg" className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-base text-slate',
                c.unreadCount ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </span>
            <span className="shrink-0 text-xs text-muted">{shortTime(c.lastMessageAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-base text-secondary">
              {c.snippet ?? c.lastMessagePreview ?? 'No messages yet'}
            </span>
            {c.unreadCount ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-strong px-1.5 text-xs font-semibold text-surface">
                {c.unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </div>
          <span className="sr-only">{context}</span>
        </div>
      </button>
    </li>
  )
}

/**
 * Conversation sidebar (docs/INBOX.md → List filters and views): search, All / Mine / Unassigned
 * with server-side counts, unread and status filters, and pages loaded as the list scrolls.
 */
export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { tenantId, me } = useSession()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<InboxView>('all')
  const [advanced, setAdvanced] = useState<AdvancedFilter>('none')
  const [status, setStatus] = useState<StatusChoice>('DEFAULT')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const q = useDebounced(search.trim())
  const filters = new URLSearchParams({
    ...(status !== 'DEFAULT' ? { status } : {}),
    ...(q ? { q } : {}),
    ...(unreadOnly ? { unread: 'true' } : {}),
  })
  // Agent takeover is its own view; the tab then narrows it by assignee.
  const params = new URLSearchParams(filters)
  if (advanced === 'takeover') {
    params.set('view', 'takeover')
    if (tab === 'mine') params.set('assigneeId', me.user.id)
    if (tab === 'unassigned') params.set('unassigned', 'true')
  } else params.set('view', tab)
  params.set('limit', String(PAGE_SIZE))

  const listKey = keys.tenant(tenantId, 'inbox', 'list')
  const list = useInfiniteQuery({
    queryKey: [...listKey, params.toString()],
    queryFn: ({ pageParam }) =>
      get<Page>(`/conversations?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
  // Counts come from the server for the same filters; the previous numbers stay until new ones
  // arrive, so they never flicker.
  const counts = useQuery({
    queryKey: [...listKey, 'counts', filters.toString()],
    queryFn: () =>
      get<{ data: ConversationCounts }>(`/conversations/counts?${filters}`).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: advanced === 'none',
  })
  // Realtime: new messages, assignments and state changes reorder or move items between tabs.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: listKey })
  useRealtimeEvent('message.created', refresh)
  useRealtimeEvent('conversation.updated', refresh)
  useRealtimeEvent('conversation.assigned', refresh)
  useRealtimeEvent('conversation.read', refresh)
  useRealtimeReconnect(
    () => void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') }),
  )

  // Load the next page as the end of the list scrolls into view.
  const end = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    const el = end.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const rows = (list.data?.pages ?? []).flatMap((p) => p.data)
  const showCounts = advanced === 'none' && counts.data
  return (
    <section aria-label="Conversations" className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-1">
        <div className="flex h-9 items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-baseline gap-2 text-xl font-semibold text-slate">
            <span className="truncate">
              {tab === 'all' ? 'Inbox' : INBOX_VIEWS.find((v) => v.id === tab)!.title}
            </span>
            {showCounts ? (
              <span className="text-base font-normal text-secondary tabular-nums">
                {counts.data[tab]}
                <span className="sr-only"> conversations</span>
              </span>
            ) : null}
          </h2>
          <InboxFilterMenu
            view={tab}
            onViewChange={setTab}
            counts={showCounts ? counts.data : undefined}
            advanced={advanced}
            onAdvancedChange={setAdvanced}
          />
        </div>
        <SearchInput
          label="Search conversations"
          placeholder="Search conversations…"
          title="Search messages, customer names or phone numbers"
          value={search}
          onValueChange={setSearch}
          className="sm:w-full"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <Switch id="inbox-unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          <Label
            htmlFor="inbox-unread-only"
            className="shrink-0 text-sm font-normal whitespace-nowrap text-secondary"
          >
            Unread only
          </Label>
          <Select value={status} onValueChange={(v: StatusChoice) => setStatus(v)}>
            <SelectTrigger
              aria-label="Conversation status"
              className="ml-auto h-8 w-auto min-w-0 px-2.5 text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'DEFAULT' ? 'Open & waiting' : STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto contain-paint">
          {list.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : !rows.length ? (
            <EmptyState
              icon={<Inbox aria-hidden="true" />}
              title={q ? 'No matches' : 'Nothing here'}
              description={
                q ? 'Try other words or a phone number.' : 'New WhatsApp messages appear here.'
              }
            />
          ) : (
            <>
              <ul aria-label="Conversation list">
                {rows.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    selected={c.id === selectedId}
                    onSelect={() => onSelect(c.id)}
                  />
                ))}
              </ul>
              {hasNextPage ? (
                <div ref={end} className="flex justify-center p-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={isFetchingNextPage}
                    onClick={() => void fetchNextPage()}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
