'use client'

import { type Notification } from '@fenwira/contracts'
import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/session/session-provider'
import { get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useRealtimeEvent } from '@/lib/realtime'
import { relativeTime } from '@/lib/relative-time'

/** In-app notifications (assignments, mentions); new ones arrive over WebSocket. */
export function NotificationsBell() {
  const { tenantId } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const key = keys.tenant(tenantId, 'notifications')
  const list = useQuery({
    queryKey: key,
    queryFn: () => get<{ data: Notification[]; meta: { unread: number } }>('/notifications'),
  })
  useRealtimeEvent(
    'notification.created',
    () => void queryClient.invalidateQueries({ queryKey: key }),
  )
  const read = useMutation({
    mutationFn: (id: string | 'all') =>
      post(id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  })
  const unread = list.data?.meta.unread ?? 0
  const items = list.data?.data ?? []
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative [&_svg]:size-5"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        >
          <Bell aria-hidden="true" />
          {unread ? (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 size-2 rounded-full bg-status-error-fg"
            />
          ) : null}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-80">
        <DropdownLabel className="flex items-center justify-between">
          Notifications
          {unread ? (
            <Button size="sm" variant="link" onClick={() => read.mutate('all')}>
              Mark all read
            </Button>
          ) : null}
        </DropdownLabel>
        <DropdownSeparator />
        {items.length ? (
          items.slice(0, 10).map((n) => (
            <DropdownItem
              key={n.id}
              onSelect={() => {
                if (!n.readAt) read.mutate(n.id)
                if (n.link) router.push(n.link)
              }}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={n.readAt ? 'text-fg' : 'font-semibold text-fg'}>{n.title}</span>
                <span className="truncate text-sm text-fg-muted">{n.body}</span>
                <span className="text-xs text-fg-muted">{relativeTime(n.createdAt)}</span>
              </span>
            </DropdownItem>
          ))
        ) : (
          <p className="px-3 py-4 text-sm text-fg-muted">You&apos;re all caught up.</p>
        )}
      </DropdownContent>
    </Dropdown>
  )
}
