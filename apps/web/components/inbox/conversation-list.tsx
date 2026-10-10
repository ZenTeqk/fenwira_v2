'use client'

import { type Conversation } from '@fenwira/contracts'
import {
  Avatar,
  Checkbox,
  cn,
  EmptyState,
  ErrorState,
  Label,
  SearchInput,
  focusRing,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { displayName, shortTime } from '@/lib/inbox'
import { useRealtimeEvent, useRealtimeReconnect } from '@/lib/realtime'
import { InboxViews, INBOX_CHOICES, type ViewChoice } from './inbox-views'

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
  const [view, setView] = useState<ViewChoice>('all')
  const [status, setStatus] = useState<Conversation['status'] | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const q = useDebounced(search.trim())
  const params = new URLSearchParams({
    view: view === 'unread' ? 'all' : view,
    ...(status !== 'ALL' ? { status } : {}),
    limit: '100',
    ...(q ? { q } : {}),
    ...(unreadOnly || view === 'unread' ? { unread: 'true' } : {}),
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
  useRealtimeReconnect(
    () => void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') }),
  )

  return (
    <div className="flex h-full min-h-0 gap-2">
      <section
        aria-label="Conversations"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div className="flex flex-col gap-2 border-b border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-md font-semibold text-slate">
              {view === 'all'
                ? 'All conversations'
                : INBOX_CHOICES.find((v) => v.id === view)?.label}
            </h2>
            <InboxViews value={view} onChange={setView} />
          </div>
          <SearchInput
            label="Search conversations"
            placeholder="Search conversations…"
            title="Search messages, customer names or phone numbers"
            value={search}
            onValueChange={setSearch}
            className="sm:w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(v: Conversation['status'] | 'ALL') => setStatus(v)}
            >
              <SelectTrigger
                aria-label="Conversation status"
                className="h-8 min-w-0 flex-1 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['ALL', 'OPEN', 'PENDING', 'SNOOZED', 'RESOLVED'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === 'ALL'
                      ? 'All statuses'
                      : s === 'PENDING'
                        ? 'Waiting on customer'
                        : s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Checkbox
              id="inbox-unread-only"
              checked={unreadOnly}
              onCheckedChange={(v) => setUnreadOnly(v === true)}
            />
            <Label htmlFor="inbox-unread-only" className="text-sm font-normal">
              Unread only
            </Label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto contain-paint">
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
                const name = displayName(c)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      title={[
                        c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned',
                        c.serviceWindow.isOpen ? 'Window open' : 'Window closed',
                        c.automationState === 'AGENT_TAKEOVER' ? 'Agent takeover' : null,
                        c.status === 'PENDING' ? 'Waiting on customer' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      aria-current={selected ? 'true' : undefined}
                      className={cn(
                        'flex w-full gap-3 border-b border-b-border/60 border-l-4 px-3 py-2.5 text-left transition-colors hover:bg-neutral-soft',
                        focusRing,
                        'focus-visible:-outline-offset-2',
                        selected ? 'border-l-primary bg-primary-soft' : 'border-l-transparent',
                      )}
                    >
                      <Avatar appearance="varied" name={name} size="md" className="size-9" />
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
                              selected ? 'text-slate' : 'text-secondary',
                            )}
                          >
                            {shortTime(c.lastMessageAt)}
                          </span>
                        </div>
                        {/* muted text fails AA on primary-soft, so the selected row uses slate */}
                        <span
                          className={cn(
                            'truncate text-base',
                            c.unreadCount && 'font-medium',
                            selected ? 'text-slate' : 'text-secondary',
                          )}
                        >
                          {c.snippet ?? c.lastMessagePreview ?? 'No messages yet'}
                        </span>
                        <span className="sr-only">
                          {c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned'}
                          {c.automationState === 'AGENT_TAKEOVER' ? ' · Agent takeover' : ''}
                          {c.status === 'PENDING' ? ' · Waiting on customer' : ''}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
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
    </div>
  )
}
