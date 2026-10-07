'use client'

import { type Conversation, type Message } from '@fenwira/contracts'
import {
  cn,
  Drawer,
  DrawerContent,
  EmptyState,
  ErrorState,
  PermissionState,
  Skeleton,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Composer } from '@/components/inbox/composer'
import { ContactPane } from '@/components/inbox/contact-pane'
import { ConversationHeader } from '@/components/inbox/conversation-header'
import { ConversationList } from '@/components/inbox/conversation-list'
import { Thread } from '@/components/inbox/thread'
import { useSession } from '@/components/session/session-provider'
import { get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useConversationRoom, useRealtimeEvent } from '@/lib/realtime'

function Chat({ id, onBack }: { id: string; onBack: () => void }) {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const [contactOpen, setContactOpen] = useState(false)
  const contactTrigger = useRef<HTMLButtonElement>(null)
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
    <div className="flex min-h-0 min-w-0 flex-1 gap-2">
      <section
        aria-label="Chat"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
      >
        <ConversationHeader
          conversation={c}
          contactButtonRef={contactTrigger}
          onBack={onBack}
          onToggleContact={() => setContactOpen(true)}
        />
        <Thread conversationId={id} />
        {can('inbox.reply') ? (
          <Composer key={id} conversation={c} />
        ) : (
          <p role="status" className="border-t border-border p-4 text-sm text-secondary">
            Your role can read conversations but cannot reply or add internal notes.
          </p>
        )}
      </section>
      <aside
        aria-label="Contact"
        className="hidden w-64 shrink-0 overflow-y-auto rounded-lg border border-border bg-surface xl:block"
      >
        <ContactPane contactId={c.contact.id} conversationId={id} assignee={c.assignee} />
      </aside>
      <Drawer open={contactOpen} onOpenChange={setContactOpen}>
        <DrawerContent
          title="Contact"
          side="right"
          width="sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            contactTrigger.current?.focus()
          }}
        >
          <ContactPane contactId={c.contact.id} conversationId={id} assignee={c.assignee} />
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function Inbox() {
  const { can } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const selected = params.get('c')
  const select = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname)
  if (!can('inbox.read')) return <PermissionState what="the inbox" />
  return (
    <div className="flex h-full min-h-0 min-w-0 gap-2 p-2">
      <h1 className="sr-only">Inbox</h1>
      <div
        className={cn(
          'min-h-0 w-full shrink-0 md:w-70 lg:w-112 xl:w-126',
          selected && 'hidden md:block',
        )}
      >
        <ConversationList selectedId={selected} onSelect={(id) => select(id)} />
      </div>
      <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <Chat key={selected} id={selected} onBack={() => select(null)} />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-background">
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

export default function InboxPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <Inbox />
    </Suspense>
  )
}
