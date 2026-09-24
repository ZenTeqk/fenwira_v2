'use client'

import { type Conversation, type InboxView } from '@fenwira/contracts'
import { Avatar, Badge, cn, EmptyState, ErrorState, Input, Skeleton } from '@fenwira/ui'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Clock, Inbox } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { displayName, shortTime, useNow } from '@/lib/inbox'
import { useRealtimeEvent } from '@/lib/realtime'
import { Segmented } from './segmented'

const VIEWS: Array<{ id: InboxView; label: string }> = [
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'all', label: 'All' },
  { id: 'takeover', label: 'Takeover' },
  { id: 'resolved', label: 'Resolved' },
]

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Conversation list pane (docs/INBOX.md → List filters and views). */
export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const now = useNow()
  const [view, setView] = useState<InboxView>('all')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const q = useDebounced(search.trim())
  const params = new URLSearchParams({
    view,
    limit: '100',
    ...(q ? { q } : {}),
    ...(unreadOnly ? { unread: 'true' } : {}),
  })
  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'inbox', 'list', params.toString()),
    queryFn: () => get<{ data: Conversation[] }>(`/conversations?${params}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  // Realtime: new messages, assignments and state changes reorder or move items between views.
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox', 'list') })
  useRealtimeEvent('message.created', refresh)
  useRealtimeEvent('conversation.updated', refresh)
  useRealtimeEvent('conversation.assigned', refresh)
  useRealtimeEvent('conversation.read', refresh)

  return (
    <section
      aria-label="Conversations"
      className="flex h-full min-h-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <Input
          type="search"
          placeholder="Search messages, names, numbers"
          aria-label="Search conversations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Segmented
          label="Views"
          value={view}
          options={VIEWS.map((v) => ({ value: v.id, label: v.label }))}
          onChange={setView}
        />
        <label className="flex items-center gap-2 text-sm text-slate">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : !list.data.length ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            title={q ? 'No matches' : 'Nothing here'}
            description={
              q ? 'Try other words or a phone number.' : 'New WhatsApp messages appear here.'
            }
          />
        ) : (
          <ul aria-label="Conversation list">
            {list.data.map((c) => {
              const selected = c.id === selectedId
              const open =
                !!c.serviceWindow.expiresAt && new Date(c.serviceWindow.expiresAt).getTime() > now
              const name = displayName(c)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'flex w-full gap-3 border-l-4 px-3 py-3 text-left transition-colors hover:bg-neutral-soft',
                      selected ? 'border-l-primary bg-primary-soft' : 'border-l-transparent',
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-slate',
                            c.unreadCount ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {name}
                        </span>
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-xs',
                            selected ? 'text-slate' : 'text-muted',
                          )}
                        >
                          {shortTime(c.lastMessageAt)}
                        </span>
                      </div>
                      {/* muted text fails AA on primary-soft, so the selected row uses slate */}
                      <span
                        className={cn('truncate text-sm', selected ? 'text-slate' : 'text-muted')}
                      >
                        {c.snippet ?? c.lastMessagePreview ?? 'No messages yet'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={open ? 'success' : 'neutral'} icon={<Clock />}>
                          {open ? 'Window open' : 'Window closed'}
                        </Badge>
                        {c.automationState === 'AGENT_TAKEOVER' ? (
                          <Badge tone="info" icon={<Bot />}>
                            Takeover
                          </Badge>
                        ) : null}
                        {c.status === 'PENDING' ? <Badge tone="warning">Pending</Badge> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {c.assignee ? <Avatar name={c.assignee.name} size="sm" /> : null}
                      {c.unreadCount ? (
                        <span className="rounded-full bg-primary-strong px-1.5 text-xs font-semibold text-surface">
                          {c.unreadCount}
                          <span className="sr-only"> unread</span>
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
