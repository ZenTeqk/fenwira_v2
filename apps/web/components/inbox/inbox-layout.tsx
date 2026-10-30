'use client'

import { type Conversation, type Message } from '@fenwira/contracts'
import { cn, EmptyState, ErrorState, PermissionState, Skeleton } from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useSession } from '@/components/session/session-provider'
import { get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useConversationRoom, useRealtimeEvent } from '@/lib/realtime'
import { Composer } from './composer'
import { ContactDetailsPanel } from './contact-details-panel'
import { type PanelTab } from './contact-pane'
import { ConversationHeader } from './conversation-header'
import { ConversationList } from './conversation-list'
import { ConversationStatusBar } from './conversation-status-bar'
import { Thread } from './thread'

/** Dock details only where the conversation has enough room beside both side panels. */
function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', callback)
      return () => media.removeEventListener('change', callback)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The inline panel's open/closed choice, remembered per user on this device. */
function usePanelPreference(userId: string) {
  const key = `fenwira.inbox.contactPanel.${userId}`
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) setOpen(stored === 'open')
    } catch {
      // Storage unavailable: the panel starts open and the choice isn't remembered.
    }
  }, [key])
  const set = useCallback(
    (value: boolean) => {
      setOpen(value)
      try {
        window.localStorage.setItem(key, value ? 'open' : 'closed')
      } catch {
        // Not remembered; the current session still follows the choice.
      }
    },
    [key],
  )
  return [open, set] as const
}

/** Chat column plus the contact panel for one conversation. */
function ConversationPane({ id, onBack }: { id: string; onBack: () => void }) {
  const { tenantId, can, me } = useSession()
  const queryClient = useQueryClient()
  const wide = useMediaQuery('(min-width: 1280px)')
  const [inlineOpen, setInlineOpen] = usePanelPreference(me.user.id)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('details')
  const [jump, setJump] = useState<{ id: string; seq: number } | null>(null)
  const panelId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const collapse = useRef<HTMLButtonElement>(null)
  const focusOnOpen = useRef(false)
  const focusOnClose = useRef(false)
  const panelOpen = wide ? inlineOpen : overlayOpen
  const setPanelOpen = wide ? setInlineOpen : setOverlayOpen
  // The header trigger unmounts while details are open. Move focus only after the
  // replacement control mounts, without stealing focus on initial page load.
  useLayoutEffect(() => {
    if (!panelOpen && focusOnClose.current) {
      focusOnClose.current = false
      toggle.current?.focus()
    }
    if (panelOpen && wide && focusOnOpen.current) {
      focusOnOpen.current = false
      collapse.current?.focus()
    }
  }, [panelOpen, wide])
  useEffect(() => {
    if (wide) setOverlayOpen(false)
  }, [wide])

  const key = keys.tenant(tenantId, 'inbox', 'conversation', id)
  const conversation = useQuery({
    queryKey: key,
    queryFn: () => get<{ data: Conversation }>(`/conversations/${id}`).then((r) => r.data),
  })
  useConversationRoom(id)
  const markRead = () =>
    void post(`/conversations/${id}/read`)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox', 'list') }),
      )
      .catch(() => undefined)
  // Opening the conversation marks it read (once per conversation).
  useEffect(markRead, [id])
  const refresh = (e: { conversationId?: string }) => {
    if (e.conversationId === id) void queryClient.invalidateQueries({ queryKey: key })
  }
  useRealtimeEvent<Message>('message.created', (m) => {
    if (m.conversationId !== id) return
    refresh(m)
    if (m.direction === 'INBOUND' && document.visibilityState === 'visible') markRead()
  })
  useRealtimeEvent('conversation.updated', refresh)
  useRealtimeEvent('conversation.assigned', refresh)

  if (conversation.isPending) return <Skeleton className="m-4 h-64 flex-1" />
  if (conversation.isError || !conversation.data)
    return (
      <ErrorState title="Conversation not available" onRetry={() => void conversation.refetch()} />
    )
  const c = conversation.data
  return (
    <div className="fw-inbox-compact-icons fw-inbox-compact-type flex min-h-0 min-w-0 flex-1">
      <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationHeader
          conversation={c}
          filtersExpanded={filtersExpanded}
          onToggleFilters={() => setFiltersExpanded((v) => !v)}
          contactButtonRef={toggle}
          onBack={onBack}
          contactExpanded={panelOpen}
          contactControlsId={panelId}
          contactIsDrawer={!wide}
          onToggleContact={() => {
            focusOnOpen.current = wide
            setPanelOpen(true)
          }}
          onSharedFiles={() => {
            setPanelTab('files')
            setPanelOpen(true)
          }}
        />
        <ConversationStatusBar conversation={c} />
        <Thread
          conversationId={id}
          jump={jump}
          showFilters={filtersExpanded}
          initialUnreadCount={c.unreadCount}
        />
        {can('inbox.reply') ? (
          <Composer key={id} conversation={c} />
        ) : (
          <p role="status" className="border-t border-border bg-surface p-4 text-sm text-secondary">
            Your role can read conversations but cannot reply or add internal notes.
          </p>
        )}
      </section>
      <ContactDetailsPanel
        id={panelId}
        conversation={c}
        variant={wide ? 'inline' : 'overlay'}
        open={panelOpen}
        onOpenChange={(open) => {
          focusOnClose.current = !open
          setPanelOpen(open)
        }}
        collapseButtonRef={collapse}
        returnFocus={toggle}
        tab={panelTab}
        onTabChange={setPanelTab}
        onJump={(messageId) => {
          // The overlay covers the chat, so it closes to show the message.
          if (!wide) setOverlayOpen(false)
          setJump((j) => ({ id: messageId, seq: (j?.seq ?? 0) + 1 }))
        }}
      />
    </div>
  )
}

/**
 * The inbox (docs/INBOX.md → Layout): one connected workspace of conversation list, chat and
 * contact details, separated by thin borders. Each column scrolls on its own; the selected
 * conversation lives in the URL (`?c=`), so refresh and deep links work.
 */
export function InboxLayout() {
  const { can } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const selected = params.get('c')
  const select = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname)
  if (!can('inbox.read')) return <PermissionState what="the inbox" />
  return (
    <div className="fw-inbox-theme flex h-full min-h-0 min-w-0 bg-background">
      <h1 className="sr-only">Inbox</h1>
      <div
        className={cn(
          'min-h-0 w-full shrink-0 border-r border-border bg-surface md:w-70 lg:w-75 xl:w-80',
          selected && 'hidden md:block',
        )}
      >
        <ConversationList selectedId={selected} onSelect={(id) => select(id)} />
      </div>
      <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <ConversationPane key={selected} id={selected} onBack={() => select(null)} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MessagesSquare aria-hidden="true" />}
              title="Pick a conversation"
              description="Choose a conversation on the left to read and reply."
            />
          </div>
        )}
      </div>
    </div>
  )
}
