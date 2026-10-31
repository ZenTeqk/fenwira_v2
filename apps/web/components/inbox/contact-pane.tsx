'use client'

import { type Contact, type ContactNote, type Conversation } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  textLink,
  cn,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Copy, Pencil } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { ContactFormModal } from '@/components/contacts/contact-form-modal'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useProperties } from '@/lib/contacts'
import { conversationAvatarLabel } from '@/lib/conversation-preview'
import { displayName } from '@/lib/inbox'
import { formatPhone } from '@/lib/phone'
import { useRealtimeEvent, useRealtimeReconnect } from '@/lib/realtime'
import { relativeTime } from '@/lib/relative-time'
import {
  AutomationSection,
  ContactNotes,
  ContactTags,
  CustomerAssignment,
  CustomerPanelError,
  EligibilitySection,
} from './contact-details'
import { CustomerActivity } from './customer-activity'
import { CustomerFields } from './customer-fields'

type PastConversation = {
  id: string
  status: string
  phoneNumber: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
}
export type PanelTab = 'details' | 'activity' | 'files'

export function ContactPane({
  contactId,
  conversation,
  tab,
  onTabChange,
  files,
}: {
  contactId: string
  conversation: Conversation
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  files: ReactNode
}) {
  const { tenantId, can } = useSession()
  const client = useQueryClient()
  const enabled = can('contacts.read')
  const base = keys.tenant(tenantId, 'contact', contactId)
  const [editing, setEditing] = useState(false)
  const [copying, setCopying] = useState(false)
  const contact = useQuery({
    queryKey: base,
    queryFn: () =>
      get<{ data: Contact }>(`/contacts/${contactId}`).then((response) => response.data),
    enabled,
    refetchOnWindowFocus: true,
  })
  const notes = useQuery({
    queryKey: [...base, 'notes'],
    queryFn: () =>
      get<{ data: ContactNote[] }>(`/contacts/${contactId}/notes`).then(
        (response) => response.data,
      ),
    enabled,
    refetchOnWindowFocus: true,
  })
  const past = useQuery({
    queryKey: [...base, 'conversations'],
    queryFn: () =>
      get<{ data: PastConversation[] }>(`/contacts/${contactId}/conversations`).then(
        (response) => response.data,
      ),
    enabled: enabled && tab === 'activity',
    refetchOnWindowFocus: true,
  })
  const definitions = useProperties()
  const refresh = () => {
    if (enabled) void client.invalidateQueries({ queryKey: base })
  }
  useRealtimeReconnect(refresh)
  useRealtimeEvent<{ contactId?: string }>('contact.updated', (event) => {
    if (event.contactId === contactId) {
      refresh()
      void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') })
      void client.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'contacts', contactId, 'eligibility'),
      })
    }
  })
  useRealtimeEvent<{ contactId?: string }>('consent.changed', (event) => {
    if (event.contactId === contactId) {
      refresh()
      void client.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'contacts', contactId, 'eligibility'),
      })
    }
  })
  const refreshActivity = (event: { conversationId?: string }) => {
    if (event.conversationId === conversation.id)
      void client.invalidateQueries({ queryKey: [...base, 'inbox-activity', conversation.id] })
  }
  useRealtimeEvent('conversation.assigned', refreshActivity)
  useRealtimeEvent('conversation.updated', refreshActivity)
  useRealtimeEvent<{ conversationId?: string; direction?: string }>('message.created', (event) => {
    if (event.direction === 'SYSTEM') refreshActivity(event)
  })
  const who = conversation.contact
  const name = displayName(conversation)
  const c = contact.data
  const editable = can('contacts.write') && definitions.isSuccess
  const others = (past.data ?? []).filter(
    (pastConversation) => pastConversation.id !== conversation.id,
  )
  const copyPhone = async () => {
    if (copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(who.phoneE164)
      toast.success('Phone number copied')
    } catch {
      toast.error('Couldn’t copy the phone number. Select and copy it manually.')
    } finally {
      setCopying(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col">
      <div
        className="flex min-h-22 min-w-0 items-start gap-3 px-4 py-2"
        aria-label="Customer identity"
      >
        <Avatar
          appearance="inbox"
          identityKey={who.id}
          fallbackLabel={conversationAvatarLabel(name)}
          name={name}
          size="lg"
          className="size-10 shrink-0 text-md"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-start gap-1">
            <h3 className="min-w-0 flex-1 break-words text-md font-semibold text-fg" title={name}>
              {name}
            </h3>
            {can('contacts.write') && c ? (
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1 size-8 shrink-0 sm:size-7"
                aria-label="Edit contact"
                title="Edit contact"
                disabled={!editable}
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 select-text break-words text-base text-fg-secondary tabular-nums">
              {formatPhone(who.phoneE164)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 sm:size-7"
              aria-label="Copy phone number"
              title="Copy phone number"
              loading={copying}
              onClick={() => void copyPhone()}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
          {enabled ? (
            <Link
              href={`/contacts/${who.id}`}
              className={cn(
                'inline-flex items-center gap-1 self-start text-xs font-medium',
                textLink,
              )}
            >
              Open contact
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as PanelTab)}
        className="min-w-0 gap-0"
      >
        <TabsList className="sticky top-0 z-10 shrink-0 bg-surface px-4" aria-label="Contact panel">
          <TabsTrigger value="details" className="h-9 flex-1 justify-center px-2 py-0 text-sm">
            Overview
          </TabsTrigger>
          {enabled ? (
            <TabsTrigger value="activity" className="h-9 flex-1 justify-center px-2 py-0 text-sm">
              Activity
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="files" className="h-9 flex-1 justify-center px-2 py-0 text-sm">
            Files
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="min-w-0">
          {files}
        </TabsContent>
        {enabled ? (
          <TabsContent value="activity" className="flex min-w-0 flex-col gap-4 p-4">
            <CustomerActivity contactId={contactId} conversationId={conversation.id} />
            {past.isPending ? (
              <Skeleton className="h-12" />
            ) : past.isError ? (
              <CustomerPanelError
                title="Conversation history couldn’t be loaded"
                onRetry={() => void past.refetch()}
              />
            ) : others.length ? (
              <details className="border-t border-border-subtle pt-2">
                <summary className="cursor-pointer py-1 text-base font-semibold text-fg">
                  Other conversations ({others.length})
                </summary>
                <ul className="flex flex-col gap-2 pt-2">
                  {others.map((pastConversation) => (
                    <li key={pastConversation.id}>
                      <Link
                        href={`/inbox?c=${pastConversation.id}`}
                        className="flex min-w-0 flex-col gap-1 border-l-2 border-border-control pl-2 text-base hover:underline"
                      >
                        <span className="line-clamp-2 break-words">
                          {pastConversation.lastMessagePreview ?? 'No messages'}
                        </span>
                        <span className="text-xs text-fg-secondary">
                          Via {pastConversation.phoneNumber}
                          {pastConversation.lastMessageAt
                            ? ` · ${relativeTime(pastConversation.lastMessageAt)}`
                            : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-xs text-fg-secondary">
                No other conversations with this customer.
              </p>
            )}
          </TabsContent>
        ) : null}
        <TabsContent value="details" className="flex min-w-0 flex-col gap-2 p-4">
          <CustomerAssignment conversation={conversation} />
          {!enabled ? (
            <p className="text-xs text-fg-secondary">Your role can&apos;t view contact details.</p>
          ) : contact.isPending ? (
            <Skeleton className="h-40" />
          ) : contact.isError || !c ? (
            <CustomerPanelError
              title="Contact details couldn’t be loaded"
              onRetry={() => void contact.refetch()}
            />
          ) : (
            <>
              <ContactTags contact={c} />
              <CustomerFields
                contact={c}
                definitions={definitions.data ?? []}
                editable={editable}
                onEdit={() => setEditing(true)}
              />
              {definitions.isError && can('contacts.write') ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-7 self-start px-0 text-xs"
                  onClick={() => void definitions.refetch()}
                >
                  Retry field definitions
                </Button>
              ) : null}
              <ContactNotes
                key={contactId}
                contactId={contactId}
                notes={notes}
                onRetry={() => void notes.refetch()}
              />
              <EligibilitySection contact={c} conversationId={conversation.id} />
              <AutomationSection conversation={conversation} />
            </>
          )}
        </TabsContent>
      </Tabs>
      {editing && c && editable ? (
        <ContactFormModal
          open={editing}
          onOpenChange={setEditing}
          contact={c}
          onSaved={(saved) => {
            client.setQueryData(base, saved)
            void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contacts') })
            void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') })
            refresh()
            toast.success('Contact updated')
          }}
        />
      ) : null}
    </div>
  )
}
