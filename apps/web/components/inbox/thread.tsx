'use client'

import { type ConversationNote, type Message, type MessageStatus } from '@fenwira/contracts'
import { Button, cn, ErrorState, focusRing, Skeleton, StatusBadge } from '@fenwira/ui'
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import Image from 'next/image'
import { followsSameSender } from '@/lib/message-grouping'
import { Paperclip, StickyNote } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { clockTime } from '@/lib/inbox'
import { useRealtimeEvent } from '@/lib/realtime'

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
  automation_paused: (d) => `${d.actorName ?? 'An agent'} paused automation`,
}

export const threadKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'thread', id)
export const notesKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'notes', id)

function MessageBody({ m }: { m: Message }) {
  const c = m.content
  switch (c.type) {
    case 'TEXT':
      return <p className="whitespace-pre-wrap break-words">{c.text}</p>
    case 'TEMPLATE':
      return (
        <p>
          <span className="text-sm text-secondary">Template</span> {c.name}
        </p>
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
          label={c.filename ?? c.type.toLowerCase()}
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
}: {
  kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'STICKER'
  fileId?: string
  label: string
  caption?: string
}) {
  const { tenantId } = useSession()
  const link = useQuery({
    queryKey: keys.tenant(tenantId, 'file-url', fileId ?? ''),
    queryFn: () =>
      get<{ data: { url: string } }>(`/files/${fileId}/download-url`).then((r) => r.data.url),
    enabled: !!fileId,
    staleTime: 240_000,
  })
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
      {link.data ? (
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

function Row({ item, grouped }: { item: Item; grouped: boolean }) {
  const { me } = useSession()
  if (item.kind === 'note')
    return (
      <div className="mx-auto w-full max-w-5/6 rounded-lg border border-warning/20 bg-note-soft px-3 py-2.5 text-slate">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warning-strong">
          <StickyNote className="size-3.5" aria-hidden="true" />
          Internal note · {item.note.authorName}
        </p>
        <p className="whitespace-pre-wrap break-words">{item.note.body}</p>
        <p className="text-xs text-secondary">{clockTime(item.note.createdAt)}</p>
      </div>
    )
  const m = item.message
  if (m.direction === 'SYSTEM') {
    const c = m.content as { event?: string; data?: Record<string, unknown> }
    return (
      <p className="mx-auto w-fit rounded-full bg-neutral-soft px-3 py-1 text-xs text-slate">
        {(c.event && EVENT_TEXT[c.event]?.(c.data ?? {})) ?? c.event} · {clockTime(m.createdAt)}
      </p>
    )
  }
  const outbound = m.direction === 'OUTBOUND'
  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex min-w-0 max-w-5/6 flex-col gap-1 rounded-lg px-3 py-2.5 text-base text-slate shadow-raised',
          outbound
            ? 'rounded-tr-sm bg-message-outbound'
            : 'rounded-tl-sm border border-border/60 bg-surface',
        )}
      >
        {!grouped && outbound ? (
          <span className="text-xs font-medium text-secondary">
            {m.sentByUserId === me.user.id
              ? 'You'
              : m.source === 'AUTOMATION'
                ? 'Automation'
                : m.source === 'CAMPAIGN'
                  ? 'Campaign'
                  : 'Workspace reply'}
          </span>
        ) : null}
        <MessageBody m={m} />
        <span
          className={cn(
            'flex items-center justify-end gap-2 text-xs',
            outbound ? 'text-slate' : 'text-secondary',
          )}
        >
          {clockTime(m.createdAt)}
          {outbound ? (
            <StatusBadge
              status={m.status as Exclude<MessageStatus, 'RECEIVED'>}
              appearance="inline"
              className="text-xs"
            />
          ) : null}
        </span>
        {m.status === 'FAILED' && m.errorDetail ? (
          <span className="text-xs text-danger-strong">{m.errorDetail}</span>
        ) : null}
      </div>
    </div>
  )
}

/** Virtualized thread, oldest at the top; scrolls to the newest on open and on new messages. */
export function Thread({ conversationId }: { conversationId: string }) {
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
                  ? { ...x, status: e.status, errorCode: e.errorCode ?? x.errorCode }
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
      .map((m): Item => ({ kind: 'message', at: m.createdAt, message: m }))
    const ns = (notes.data ?? []).map((n): Item => ({ kind: 'note', at: n.createdAt, note: n }))
    return [...ms, ...ns].sort((a, b) => a.at.localeCompare(b.at))
  }, [messages.data, notes.data])

  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 64,
    overscan: 8,
  })
  const newest = items.at(-1)
  const nearBottom = useRef(true)
  useEffect(() => {
    if (items.length && nearBottom.current)
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
  }, [newest?.at, items.length, virtualizer])

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
    <div
      ref={scroller}
      tabIndex={0}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto bg-thread-soft px-4 py-4',
        focusRing,
        'focus-visible:-outline-offset-2',
      )}
      role="log"
      aria-live="polite"
      aria-label="Messages"
      onScroll={(e) => {
        const el = e.currentTarget
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
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
            onClick={() => void messages.fetchNextPage()}
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
            followsSameSender(item.message, previous.message)
          const date = new Date(item.at).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
          const newDay =
            !previous || new Date(item.at).toDateString() !== new Date(previous.at).toDateString()
          return (
            <div
              key={item.kind === 'note' ? `n-${item.note.id}` : item.message.id}
              data-index={v.index}
              ref={virtualizer.measureElement}
              className={cn('absolute left-0 top-0 w-full pb-1', grouped ? 'pt-0.5' : 'pt-3')}
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {newDay ? (
                <p className="mx-auto mb-3 w-fit rounded-md bg-surface px-3 py-1 text-xs font-medium text-secondary shadow-raised">
                  {date}
                </p>
              ) : null}
              <Row item={item} grouped={grouped} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
