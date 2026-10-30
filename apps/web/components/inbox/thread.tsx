'use client'

import {
  type ConversationNote,
  type MediaCounts,
  type Message,
  type MessageStatus,
  type ThreadTypeFilter,
} from '@fenwira/contracts'
import {
  Button,
  cn,
  ErrorState,
  focusRing,
  MessageFailure,
  MessageTicks,
  Skeleton,
} from '@fenwira/ui'
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import Image from 'next/image'
import { followsSameSender } from '@/lib/message-grouping'
import {
  ArrowDown,
  Download,
  FileText,
  Hand,
  Lock,
  Paperclip,
  Play,
  UserRound,
  CircleDot,
} from 'lucide-react'
import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { clockTime } from '@/lib/inbox'
import { useRealtimeEvent } from '@/lib/realtime'
import { fileSize, fileType, useFileUrl } from './media'
import { mediaCountsKey, MediaResults, type ThreadFilter, ThreadFilterChips } from './media-filter'
import { usePresence } from './conversation-actions'
import { TemplateMessage } from './template-message'

type Page = { data: Message[]; page: { nextCursor: string | null } }
type Item =
  | { kind: 'message'; at: string; message: Message }
  | { kind: 'note'; at: string; note: ConversationNote }

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  assigned: (d) => `${d.actorName ?? 'Fenwira'} assigned this to ${d.toName ?? 'someone'}`,
  unassigned: (d) => `${d.actorName ?? 'Fenwira'} unassigned this conversation`,
  status_changed: (d) =>
    d.reason === 'snooze_ended'
      ? 'Snooze ended; conversation reopened'
      : `${d.actorName ?? 'Fenwira'} marked it ${String(d.to).toLowerCase()}`,
  takeover: (d) => `${d.actorName ?? 'An agent'} took over from automation`,
  automation_resumed: (d) =>
    d.reason === 'auto_release'
      ? 'Returned to automation (idle takeover)'
      : `${d.actorName ?? 'An agent'} returned it to automation`,
  ai_handoff: () => 'AI handed this conversation to an agent',
  automation_paused: (d) => `${d.actorName ?? 'An agent'} paused automation`,
}

export const threadKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'thread', id)
export const notesKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'notes', id)

function MessageBody({ m, labelId, bodyId }: { m: Message; labelId: string; bodyId: string }) {
  const c = m.content
  switch (c.type) {
    case 'TEXT':
      return <p className="whitespace-pre-wrap break-words">{c.text}</p>
    case 'TEMPLATE':
      return (
        <TemplateMessage
          snapshot={m.templateSnapshot}
          name={c.name}
          labelId={labelId}
          bodyId={bodyId}
        />
      )
    case 'INTERACTIVE':
      return <p>{c.text ?? 'Interactive reply'}</p>
    case 'REACTION':
      return <p aria-label={`Reacted ${c.emoji}`}>{c.emoji}</p>
    case 'LOCATION':
      return <p>📍 {c.name ?? `${c.latitude}, ${c.longitude}`}</p>
    case 'IMAGE':
    case 'DOCUMENT':
    case 'AUDIO':
    case 'VIDEO':
    case 'STICKER':
      return (
        <MediaBody
          kind={c.type}
          fileId={c.fileId}
          label={m.media?.filename ?? c.filename ?? c.type.toLowerCase()}
          media={m.media}
          caption={c.caption}
        />
      )
    default:
      return <p className="text-secondary">Unsupported message</p>
  }
}

function MediaBody({
  kind,
  fileId,
  label,
  caption,
  media,
}: {
  kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'STICKER'
  fileId?: string
  label: string
  caption?: string
  media?: Message['media']
}) {
  const link = useFileUrl(fileId)
  return (
    <div className="flex flex-col gap-1">
      {link.data && (kind === 'IMAGE' || kind === 'STICKER') ? (
        <Image
          src={link.data}
          unoptimized
          width={320}
          height={240}
          alt={label}
          className="h-auto max-w-full rounded-md"
        />
      ) : null}
      {link.data && kind === 'AUDIO' ? (
        <audio controls src={link.data} className="max-w-full" aria-label={label} />
      ) : null}
      {link.data && kind === 'VIDEO' ? (
        <video
          controls
          src={link.data}
          className="max-h-72 max-w-full rounded-md"
          aria-label={label}
        >
          <track kind="captions" />
        </video>
      ) : null}
      {kind === 'DOCUMENT' ? (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface p-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger-strong">
            <FileText aria-hidden="true" className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-semibold" title={label}>
              {label}
            </p>
            <p className="text-xs text-secondary">
              {fileType(label, media?.mimeType ?? null)}
              {media?.sizeBytes != null ? ` · ${fileSize(media.sizeBytes)}` : ''}
            </p>
          </div>
          {link.data ? (
            <a
              href={link.data}
              target="_blank"
              rel="noreferrer"
              aria-label={`Download ${label}`}
              title={`Download ${label}`}
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-secondary hover:bg-surface-hover sm:size-8',
                focusRing,
              )}
            >
              <Download aria-hidden="true" className="size-4" />
            </a>
          ) : (
            <span className="text-xs text-secondary">
              {link.isError ? 'Unavailable' : 'Loading…'}
            </span>
          )}
        </div>
      ) : link.data ? (
        <a
          href={link.data}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-primary-strong underline"
        >
          <Paperclip aria-hidden="true" className="size-4" /> {label}
        </a>
      ) : (
        <span className="flex items-center gap-1 text-secondary">
          <Paperclip aria-hidden="true" className="size-4" />{' '}
          {fileId ? label : `${label} (downloading…)`}
        </span>
      )}
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
    </div>
  )
}

function Row({
  item,
  grouped,
  names,
}: {
  item: Item
  grouped: boolean
  /** Workspace members by id, to name other agents' replies. */
  names: Map<string, string>
}) {
  const { me } = useSession()
  const ids = useId()
  if (item.kind === 'note')
    return (
      <div className="fw-inbox-bubble ml-auto w-fit rounded-lg border border-chat-note-border bg-chat-note px-3 py-2.5 text-slate">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-chat-note-fg">
          <Lock className="size-3.5" aria-hidden="true" />
          Internal note · {item.note.authorName}
        </p>
        <p className="whitespace-pre-wrap break-words">{item.note.body}</p>
        <p className="text-xs text-secondary">{clockTime(item.note.createdAt)}</p>
      </div>
    )
  const m = item.message
  if (m.direction === 'SYSTEM') {
    const c = m.content as { event?: string; data?: Record<string, unknown> }
    const Icon =
      c.event === 'takeover'
        ? Hand
        : c.event === 'automation_resumed'
          ? Play
          : c.event === 'assigned' || c.event === 'unassigned'
            ? UserRound
            : CircleDot
    return (
      <p className="mx-auto flex w-fit max-w-5/6 items-start justify-center gap-1.5 px-2 py-0.5 text-center text-xs text-secondary">
        <Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        <span>
          {(c.event && EVENT_TEXT[c.event]?.(c.data ?? {})) ?? c.event} · {clockTime(m.createdAt)}
        </span>
      </p>
    )
  }
  const outbound = m.direction === 'OUTBOUND'
  const sender = m.aiGenerated
    ? 'AI'
    : m.source === 'AUTOMATION'
      ? 'Automation'
      : m.source === 'CAMPAIGN'
        ? 'Campaign'
        : m.sentByUserId && m.sentByUserId !== me.user.id
          ? (names.get(m.sentByUserId) ?? 'Workspace reply')
          : m.sentByUserId === me.user.id
            ? me.user.name
            : null
  const template = m.content.type === 'TEMPLATE'
  const labelId = `${ids}-label`
  const bodyId = `${ids}-body`
  return (
    <div className={cn('flex flex-col', outbound ? 'items-end' : 'items-start')}>
      <div
        // A template bubble is named by its label and body text (the buttons are display-only).
        {...(template
          ? {
              role: 'group',
              'aria-labelledby': m.templateSnapshot?.body ? `${labelId} ${bodyId}` : labelId,
            }
          : {})}
        className={cn(
          'fw-inbox-bubble flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-base leading-normal text-slate',
          outbound
            ? 'border-border bg-chat-outgoing'
            : 'border border-chat-incoming-border bg-chat-incoming contrast-more:border-border-control',
        )}
      >
        {/* Only other senders are named, at the start of their group (never "You"). */}
        {!grouped && outbound && sender ? (
          <span className="text-xs font-medium text-slate">{sender}</span>
        ) : null}
        <MessageBody m={m} labelId={labelId} bodyId={bodyId} />
        <span
          className={cn(
            'flex items-center justify-end gap-1 text-xs',
            // Muted fails AA as text on the outbound tint, so outbound metadata uses secondary.
            // The ticks are non-text icons (3:1) and keep their own colours (MessageTicks).
            outbound ? 'text-slate' : 'text-muted',
          )}
        >
          {clockTime(m.createdAt)}
          {/* A failed message never shows ticks; its failure line sits under the bubble. */}
          {outbound && m.status !== 'FAILED' ? <MessageTicks status={m.status} /> : null}
        </span>
      </div>
      {outbound && m.status === 'FAILED' ? (
        <MessageFailure errorCode={m.errorCode} errorDetail={m.errorDetail} className="mt-1" />
      ) : null}
    </div>
  )
}

/** Virtualized thread, oldest at the top; scrolls to the newest on open and on new messages. */
export function Thread({
  conversationId,
  jump,
  showFilters = false,
  initialUnreadCount = 0,
}: {
  conversationId: string
  showFilters?: boolean
  initialUnreadCount?: number
  /** "Jump to message" from Shared files; a new `seq` repeats a jump to the same message. */
  jump?: { id: string; seq: number } | null
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const key = threadKey(tenantId, conversationId)
  const messages = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      get<Page>(
        `/conversations/${conversationId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  })
  // Snapshot the opening unread count before the existing mark-read request clears it.
  const [openingUnread] = useState(initialUnreadCount)
  const unreadAnchor = useRef<string | null>(null)
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  // The chips above the timeline (All / Images / … / Notes); the thread remounts per conversation.
  const [filter, setFilter] = useState<ThreadFilter | null>(null)
  useEffect(() => {
    if (!jump) return
    setFilter(null)
    setJumpTo(jump.id)
  }, [jump])
  const countsKey = mediaCountsKey(tenantId, conversationId)
  const notes = useQuery({
    queryKey: notesKey(tenantId, conversationId),
    queryFn: () =>
      get<{ data: ConversationNote[] }>(`/conversations/${conversationId}/notes`).then(
        (r) => r.data,
      ),
  })

  // Live updates: new messages, status ticks and notes patch the caches directly.
  useRealtimeEvent<Message>('message.created', (m) => {
    if (m.conversationId !== conversationId) return
    void queryClient.invalidateQueries({ queryKey: countsKey })
    void queryClient.invalidateQueries({ queryKey: [...key, 'media'] })
    queryClient.setQueryData<InfiniteData<Page>>(key, (old) => {
      if (!old || old.pages[0]!.data.some((x) => x.id === m.id)) return old
      const [first, ...rest] = old.pages
      return { ...old, pages: [{ ...first!, data: [m, ...first!.data] }, ...rest] }
    })
  })
  useRealtimeEvent<{
    messageId: string
    conversationId: string
    status: MessageStatus
    errorCode?: string
    errorDetail?: string
  }>('message.status', (e) => {
    if (e.conversationId !== conversationId) return
    queryClient.setQueryData<InfiniteData<Page>>(key, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: p.data.map((x) =>
                x.id === e.messageId
                  ? {
                      ...x,
                      status: e.status,
                      errorCode: e.errorCode ?? x.errorCode,
                      errorDetail: e.errorDetail ?? x.errorDetail,
                    }
                  : x,
              ),
            })),
          }
        : old,
    )
  })
  useRealtimeEvent<Message>('message.updated', (m) => {
    if (m.conversationId === conversationId) void queryClient.invalidateQueries({ queryKey: key })
  })
  useRealtimeEvent<{ conversationId: string }>('conversation.updated', (e) => {
    if (e.conversationId === conversationId) void queryClient.invalidateQueries({ queryKey: key })
  })
  useRealtimeEvent<ConversationNote>('note.created', (n) => {
    if (n.conversationId !== conversationId) return
    queryClient.setQueryData<ConversationNote[]>(notesKey(tenantId, conversationId), (old) =>
      old && !old.some((x) => x.id === n.id) ? [...old, n] : old,
    )
  })

  const items = useMemo<Item[]>(() => {
    const ms = (messages.data?.pages ?? [])
      .flatMap((p) => p.data)
      .reverse()
      .map((m): Item => ({ kind: 'message', at: m.createdAt, message: m }))
    const ns = (notes.data ?? []).map((n): Item => ({ kind: 'note', at: n.createdAt, note: n }))
    return [...ms, ...ns].sort((a, b) => a.at.localeCompare(b.at))
  }, [messages.data, notes.data])

  const inboundMessages = items.filter(
    (item) => item.kind === 'message' && item.message.direction === 'INBOUND',
  )
  if (!unreadAnchor.current && openingUnread > 0 && inboundMessages.length >= openingUnread) {
    const firstUnread = inboundMessages.at(-openingUnread)
    if (firstUnread?.kind === 'message') unreadAnchor.current = firstUnread.message.id
  }

  const members = usePresence()
  const names = useMemo(
    () => new Map((members.data ?? []).map((p) => [p.userId, p.name])),
    [members.data],
  )
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getItemKey: (index) => {
      const item = items[index]!
      return item.kind === 'message' ? item.message.id : `note-${item.note.id}`
    },
    getScrollElement: () => scroller.current,
    estimateSize: () => 64,
    overscan: 8,
  })
  // Keep the visible row anchored when a page is prepended to the virtualized timeline.
  const anchor = useRef<{ key: string; top: number } | null>(null)
  const loadEarlier = () => {
    const el = scroller.current
    if (el) {
      const top = el.getBoundingClientRect().top
      const first = [...el.querySelectorAll<HTMLElement>('[data-message-id], [data-note-id]')].find(
        (row) => row.getBoundingClientRect().bottom > top,
      )
      if (first)
        anchor.current = {
          key: first.dataset.messageId ?? `note-${first.dataset.noteId}`,
          top: first.getBoundingClientRect().top - top,
        }
    }
    nearBottom.current = false
    void messages.fetchNextPage()
  }
  useLayoutEffect(() => {
    if (!anchor.current || messages.isFetchingNextPage) return
    const saved = anchor.current
    const index = items.findIndex(
      (item) => (item.kind === 'message' ? item.message.id : `note-${item.note.id}`) === saved.key,
    )
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'start' })
    let attempts = 0
    let stable = 0
    let frame: number
    // Newly mounted rows are measured asynchronously. Correct against the actual message,
    // including the removed paging control and date divider, until those measurements settle.
    const restore = () => {
      const el = scroller.current
      const target =
        el &&
        [...el.querySelectorAll<HTMLElement>('[data-message-id], [data-note-id]')].find(
          (row) => (row.dataset.messageId ?? `note-${row.dataset.noteId}`) === saved.key,
        )
      if (el && target) {
        const delta =
          target.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.top
        if (Math.abs(delta) > 0.5) {
          virtualizer.scrollToOffset(el.scrollTop + delta)
          stable = 0
        } else stable++
      }
      if (++attempts < 12 && stable < 3) frame = requestAnimationFrame(restore)
      else anchor.current = null
    }
    frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [items, messages.isFetchingNextPage, virtualizer])
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const lastNewest = useRef<string | null>(null)
  const timelineHeight = virtualizer.getTotalSize()
  const newest = items.at(-1)
  const nearBottom = useRef(true)
  useEffect(() => {
    const newestKey = newest
      ? newest.kind === 'message'
        ? newest.message.id
        : newest.note.id
      : null
    if (lastNewest.current && newestKey !== lastNewest.current && !nearBottom.current)
      setHasNewMessages(true)
    lastNewest.current = newestKey
    if (items.length && nearBottom.current && !jumpTo)
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
  }, [newest, items.length, timelineHeight, virtualizer, jumpTo])

  // "Jump to message" from a media view: load earlier pages until it is in the thread, then scroll
  // to it and move focus there.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages
  useEffect(() => {
    if (!jumpTo || filter) return
    const index = items.findIndex(
      (i) => (i.kind === 'message' ? i.message.id : i.note.id) === jumpTo,
    )
    if (index >= 0) {
      nearBottom.current = false
      virtualizer.scrollToIndex(index, { align: 'center' })
      const target = jumpTo
      setJumpTo(null)
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(index, { align: 'center' })
        scroller.current
          ?.querySelector<HTMLElement>(`[data-message-id="${target}"], [data-note-id="${target}"]`)
          ?.focus({ preventScroll: true })
      })
    } else if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    else if (!hasNextPage) setJumpTo(null)
  }, [jumpTo, filter, items, virtualizer, hasNextPage, isFetchingNextPage, fetchNextPage])

  const counts = useQuery({
    queryKey: countsKey,
    queryFn: () =>
      get<{ data: MediaCounts }>(`/conversations/${conversationId}/media-counts`).then(
        (r) => r.data,
      ),
  })
  const chips = showFilters ? (
    <ThreadFilterChips
      value={filter}
      onChange={setFilter}
      counts={counts.data ? { ...counts.data, notes: notes.data?.length ?? 0 } : undefined}
    />
  ) : null
  const jumpFromFilter = (id: string) => {
    setFilter(null)
    setJumpTo(id)
  }
  if (filter) {
    const loaded = (messages.data?.pages ?? []).flatMap((p) => p.data)
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-chat-canvas">
        {chips}
        {filter === 'notes' ? (
          <FilteredItems
            items={(notes.data ?? [])
              .map((n): Item => ({ kind: 'note', at: n.createdAt, note: n }))
              .reverse()}
            empty="No internal notes in this conversation"
            names={names}
            onJump={jumpFromFilter}
          />
        ) : filter === 'audio' || filter === 'template' ? (
          <TypeResults
            conversationId={conversationId}
            kind={filter}
            names={names}
            onJump={jumpFromFilter}
          />
        ) : (
          <MediaResults
            conversationId={conversationId}
            filter={filter}
            loaded={loaded}
            onJump={jumpFromFilter}
          />
        )}
      </div>
    )
  }

  if (messages.isPending)
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={cn('h-10 w-2/3', i % 2 && 'self-end')} />
        ))}
      </div>
    )
  if (messages.isError)
    return (
      <ErrorState title="Messages couldn’t be loaded" onRetry={() => void messages.refetch()} />
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chips}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-chat-canvas">
        <div
          ref={scroller}
          tabIndex={0}
          className={cn(
            'fw-inbox-timeline relative h-full min-h-0 overflow-y-auto px-6 py-4',
            focusRing,
            'focus-visible:-outline-offset-2',
          )}
          role="log"
          aria-live="polite"
          aria-label="Messages"
          onScroll={(e) => {
            const el = e.currentTarget
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
            if (nearBottom.current) setHasNewMessages(false)
          }}
        >
          {notes.isError ? (
            <ErrorState
              title="Internal notes couldn’t be loaded"
              onRetry={() => void notes.refetch()}
            />
          ) : null}
          {messages.hasNextPage ? (
            <div className="flex justify-center pb-2">
              <Button
                size="sm"
                variant="ghost"
                loading={messages.isFetchingNextPage}
                onClick={loadEarlier}
              >
                Load earlier messages
              </Button>
            </div>
          ) : null}
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index]!
              const previous = items[v.index - 1]
              const grouped =
                item.kind === 'message' &&
                previous?.kind === 'message' &&
                item.message.type === previous.message.type &&
                followsSameSender(item.message, previous.message)
              const date = new Date(item.at).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
              const newDay =
                !previous ||
                new Date(item.at).toDateString() !== new Date(previous.at).toDateString()
              return (
                <div
                  key={item.kind === 'note' ? `n-${item.note.id}` : item.message.id}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'absolute left-0 top-0 w-full pb-1',
                    item.kind === 'message' && item.message.direction === 'SYSTEM'
                      ? 'pt-1'
                      : grouped
                        ? 'pt-0.5'
                        : 'pt-4',
                  )}
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  {newDay ? (
                    <p className="mx-auto mb-4 mt-1 w-fit rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-secondary">
                      {date}
                    </p>
                  ) : null}
                  {item.kind === 'message' && item.message.id === unreadAnchor.current ? (
                    <div
                      role="separator"
                      aria-label={`${openingUnread} unread messages`}
                      className="mb-4 flex items-center gap-3 text-xs text-secondary"
                    >
                      <span className="h-px flex-1 bg-border-strong" />
                      {openingUnread} unread messages
                      <span className="h-px flex-1 bg-border-strong" />
                    </div>
                  ) : null}
                  <div
                    {...(item.kind === 'message'
                      ? { 'data-message-id': item.message.id, tabIndex: -1 }
                      : { 'data-note-id': item.note.id, tabIndex: -1 })}
                    className={cn('rounded-md', focusRing)}
                  >
                    <Row item={item} grouped={grouped} names={names} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {hasNewMessages ? (
          <Button
            size="sm"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-raised"
            onClick={() => {
              nearBottom.current = true
              virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
              setHasNewMessages(false)
            }}
          >
            <ArrowDown aria-hidden="true" />
            New messages
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** A filtered list of timeline items (newest first), each with "Jump to message". */
function FilteredItems({
  items,
  empty,
  names,
  onJump,
  footer,
}: {
  items: Item[]
  empty: string
  names: Map<string, string>
  onJump: (id: string) => void
  footer?: ReactNode
}) {
  if (!items.length)
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted">{empty}</p>
      </div>
    )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-4">
        {items.map((item) => {
          const id = item.kind === 'message' ? item.message.id : item.note.id
          return (
            <li key={id} className="flex flex-col gap-1">
              <Row item={item} grouped={false} names={names} />
              <Button
                variant="link"
                size="sm"
                className={cn(
                  'self-start',
                  item.kind === 'message' && item.message.direction === 'OUTBOUND' && 'self-end',
                )}
                onClick={() => onJump(id)}
              >
                Jump to message
              </Button>
            </li>
          )
        })}
      </ul>
      {footer}
    </div>
  )
}

/** Audio or template messages from the server (`kind=`), paged. */
function TypeResults({
  conversationId,
  kind,
  names,
  onJump,
}: {
  conversationId: string
  kind: ThreadTypeFilter
  names: Map<string, string>
  onJump: (id: string) => void
}) {
  const { tenantId } = useSession()
  const query = useInfiniteQuery({
    queryKey: [...threadKey(tenantId, conversationId), 'kind', kind],
    queryFn: ({ pageParam }) =>
      get<Page>(
        `/conversations/${conversationId}/messages?kind=${kind}&limit=30${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  })
  if (query.isPending)
    return (
      <div className="flex flex-col gap-3 p-6">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-2/3" />
        ))}
      </div>
    )
  if (query.isError)
    return <ErrorState title="Messages couldn’t be loaded" onRetry={() => void query.refetch()} />
  return (
    <FilteredItems
      items={query.data.pages
        .flatMap((p) => p.data)
        .map((m): Item => ({ kind: 'message', at: m.createdAt, message: m }))}
      empty={
        kind === 'audio'
          ? 'No audio in this conversation'
          : 'No template messages in this conversation'
      }
      names={names}
      onJump={onJump}
      footer={
        query.hasNextPage ? (
          <div className="flex justify-center pt-3">
            <Button
              size="sm"
              variant="ghost"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null
      }
    />
  )
}
