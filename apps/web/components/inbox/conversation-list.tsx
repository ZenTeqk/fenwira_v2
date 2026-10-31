'use client'

import { type Conversation, type ConversationCounts, type Message } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  cn,
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownLabel,
  DropdownTrigger,
  EmptyState,
  ErrorState,
  focusRing,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Tooltip,
} from '@fenwira/ui'
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  FileText,
  Image,
  Inbox,
  LayoutTemplate,
  Mic,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  conversationAvatarLabel,
  conversationPreview,
  latestPreviewMessage,
} from '@/lib/conversation-preview'
import { displayName, shortTime } from '@/lib/inbox'
import { useRealtimeEvent, useRealtimeReconnect } from '@/lib/realtime'
import { STATUS_LABEL } from './conversation-actions'
import { type AdvancedFilter, INBOX_VIEWS, type InboxView } from './inbox-views'

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
const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const PREVIEW_ICONS = {
  template: LayoutTemplate,
  document: FileText,
  image: Image,
  audio: Mic,
  video: Video,
}

/** Subscribe to the existing unfiltered thread cache. This observer never fetches per-row data. */
function useCachedPreview(conversationId: string) {
  const { tenantId } = useSession()
  const client = useQueryClient()
  const key = useMemo(
    () => keys.tenant(tenantId, 'inbox', 'thread', conversationId),
    [tenantId, conversationId],
  )
  const subscribe = useCallback(
    (notify: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.query.queryKey.length === key.length &&
          key.every((part, index) => event.query.queryKey[index] === part)
        )
          notify()
      }),
    [client, key],
  )
  const snapshot = useCallback(
    () => client.getQueryData<InfiniteData<{ data: Message[] }>>(key),
    [client, key],
  )
  const cached = useSyncExternalStore(subscribe, snapshot, () => undefined)
  return useMemo(() => latestPreviewMessage(cached?.pages.flatMap((p) => p.data) ?? []), [cached])
}

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
  const cached = useCachedPreview(c.id)
  const preview = conversationPreview(c, cached)
  const PreviewIcon = preview.kind ? PREVIEW_ICONS[preview.kind] : null
  const context = [
    c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned',
    c.automationState === 'AGENT_TAKEOVER' ? 'Agent takeover' : null,
    c.status !== 'OPEN' ? STATUS_LABEL[c.status] : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="min-w-0">
      <Tooltip
        content={
          <>
            <span className="font-medium">{name}</span>
            <span className="block">{context}</span>
          </>
        }
        side="right"
      >
        <button
          type="button"
          onClick={onSelect}
          title={`${name} · ${context}`}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'group/row relative flex min-h-19 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-3 text-left transition-colors motion-reduce:transition-none',
            focusRing,
            'focus-visible:-outline-offset-2',
            // Neutral selection with a slim emerald bar; hover is lighter than selection, and
            // keyboard focus keeps its own outline (focusRing).
            selected ? 'bg-surface-selected' : 'bg-surface hover:bg-surface-muted',
          )}
        >
          {selected ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-5 left-0 w-0.75 rounded-full bg-action-primary"
            />
          ) : null}
          <Avatar
            appearance="inbox"
            identityKey={c.contact.id}
            name={name}
            fallbackLabel={conversationAvatarLabel(name)}
            size="lg"
            className="size-9 shrink-0 text-base"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-base text-fg',
                c.unreadCount ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </span>
            <div
              className={cn(
                'flex min-w-0 items-center gap-1 text-sm group-hover/row:text-fg',
                c.unreadCount || selected ? 'text-fg' : 'text-fg-secondary',
              )}
              title={preview.text}
            >
              {preview.failed ? (
                <StatusBadge
                  status="FAILED"
                  label="Failed"
                  appearance="inline"
                  className="shrink-0"
                />
              ) : PreviewIcon ? (
                <PreviewIcon aria-hidden="true" className="size-3.5 shrink-0" />
              ) : null}
              {!preview.failed && preview.deliveryStatus ? (
                <StatusBadge
                  status={preview.deliveryStatus}
                  appearance="inline"
                  className="shrink-0"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{preview.text}</span>
            </div>
            <span className="sr-only">{context}</span>
          </div>
          <div className="flex max-w-20 shrink-0 flex-col items-end gap-2 self-stretch justify-center">
            <span
              className={cn(
                'text-xs whitespace-nowrap tabular-nums group-hover/row:text-fg',
                selected || c.unreadCount ? 'font-medium text-fg' : 'text-fg-muted',
              )}
            >
              {shortTime(c.lastMessageAt)}
            </span>
            {c.unreadCount ? (
              <span
                title={`${c.unreadCount} unread`}
                aria-label={`${c.unreadCount} unread`}
                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-action-primary px-1.5 text-xs font-semibold text-action-primary-fg tabular-nums"
              >
                <span aria-hidden="true">{compactCount.format(c.unreadCount)}</span>
              </span>
            ) : c.assignee ? (
              <span title={`Assigned to ${c.assignee.name}`}>
                <Avatar
                  appearance="inbox"
                  identityKey={c.assignee.id}
                  name={c.assignee.name}
                  size="sm"
                  className="size-5"
                />
              </span>
            ) : null}
          </div>
        </button>
      </Tooltip>
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
  // Enrich existing cached threads from the same authorized events, including conversations
  // that were opened earlier. Do not create new thread queries or fetch individual rows.
  useRealtimeEvent<Message>('message.created', (message) => {
    const key = keys.tenant(tenantId, 'inbox', 'thread', message.conversationId)
    queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(key, (old) => {
      if (!old?.pages[0] || old.pages.some((page) => page.data.some((m) => m.id === message.id)))
        return old
      const [first, ...rest] = old.pages
      return { ...old, pages: [{ ...first!, data: [message, ...first!.data] }, ...rest] }
    })
    refresh()
  })
  useRealtimeEvent<Message>('message.updated', (message) => {
    const key = keys.tenant(tenantId, 'inbox', 'thread', message.conversationId)
    queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(
      key,
      (old) =>
        old && {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.id === message.id ? { ...m, ...message, media: message.media ?? m.media } : m,
            ),
          })),
        },
    )
    refresh()
  })
  useRealtimeEvent<{
    conversationId: string
    messageId: string
    status: Message['status']
    errorCode?: string
    errorDetail?: string
  }>('message.status', (event) => {
    const key = keys.tenant(tenantId, 'inbox', 'thread', event.conversationId)
    queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(
      key,
      (old) =>
        old && {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.id === event.messageId
                ? {
                    ...m,
                    status: event.status,
                    errorCode: event.errorCode ?? m.errorCode,
                    errorDetail: event.errorDetail ?? m.errorDetail,
                  }
                : m,
            ),
          })),
        },
    )
    refresh()
  })
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
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
        <div className="flex h-9 items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-baseline gap-2 text-lg font-semibold text-fg">
            <span className="truncate">Inbox</span>
            {showCounts ? (
              <span className="rounded-md bg-surface-muted px-2 py-0.5 text-sm font-normal text-fg tabular-nums">
                {counts.data[tab].toLocaleString('en')}
                <span className="sr-only"> conversations</span>
              </span>
            ) : null}
          </h2>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <SearchInput
            label="Search conversations"
            placeholder="Search conversations…"
            title="Search messages, customer names or phone numbers"
            value={search}
            onValueChange={setSearch}
            className="min-w-0 flex-1 sm:w-full"
          />
          <Dropdown>
            <DropdownTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className={cn(
                  'size-9 shrink-0',
                  advanced === 'takeover' && 'border-fg bg-surface-selected text-fg',
                )}
                aria-label="Advanced conversation filters"
                aria-description={
                  advanced === 'takeover' ? 'Agent takeover filter active' : undefined
                }
              >
                <SlidersHorizontal aria-hidden="true" />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end" className="fw-inbox-theme">
              <DropdownLabel>Advanced filters</DropdownLabel>
              <DropdownCheckboxItem
                checked={advanced === 'takeover'}
                onCheckedChange={(checked) => setAdvanced(checked ? 'takeover' : 'none')}
              >
                Agent takeover
              </DropdownCheckboxItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="group"
          aria-label="Inbox views"
          className="fw-inbox-view-segments mx-4 grid shrink-0 gap-0.5 rounded-lg bg-surface-muted p-0.5"
        >
          {INBOX_VIEWS.map(({ id, label }) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              aria-pressed={tab === id}
              aria-label={showCounts ? `${label} ${counts.data[id]}` : label}
              title={showCounts ? `${label}: ${counts.data[id]} conversations` : label}
              onClick={() => setTab(id)}
              className={cn(
                'h-8 w-full min-w-0 gap-1 overflow-hidden rounded-md border px-0.5 text-xs focus-visible:-outline-offset-2',
                tab === id
                  ? 'border-border-control bg-surface font-semibold text-fg shadow-raised hover:bg-surface hover:text-fg'
                  : 'border-transparent text-fg-secondary hover:text-fg',
              )}
            >
              <span className="shrink-0">{label}</span>
              {showCounts ? (
                <span
                  className={cn(
                    'min-w-0 truncate text-xs tabular-nums',
                    tab === id ? 'text-fg' : 'text-fg-secondary',
                  )}
                >
                  {compactCount.format(counts.data[id])}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Conversation filters"
          className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"
        >
          <Select value={status} onValueChange={(v: StatusChoice) => setStatus(v)}>
            <SelectTrigger
              aria-label="Conversation status"
              className="h-8 w-auto min-w-0 gap-2 px-2 text-xs"
            >
              <span className="min-w-0 truncate">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent align="start">
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'DEFAULT' ? 'Open & waiting' : STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={cn(
              'h-8 rounded-full px-2.5 text-xs',
              unreadOnly && 'border-fg bg-surface-selected font-semibold text-fg',
            )}
          >
            Unread
          </Button>
          {advanced === 'takeover' ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label="Remove Agent takeover filter"
              onClick={() => setAdvanced('none')}
              className="h-8 gap-1.5 rounded-full border-fg bg-surface-selected px-2.5 text-xs font-semibold text-fg"
            >
              Agent takeover <X aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
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
              <ul
                aria-label="Conversation list"
                className="flex min-w-0 flex-col gap-0.5 px-2 pb-2"
              >
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
