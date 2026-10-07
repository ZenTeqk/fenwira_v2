'use client'

import { type AutomationState, type Conversation, type Presence } from '@fenwira/contracts'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Ref } from 'react'
import { ArrowLeft, PanelRight, UserPlus } from 'lucide-react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, post, put } from '@/lib/api/client'
import { del } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { TAG_TONE, useTags } from '@/lib/contacts'
import { displayName, useNow, windowLeft } from '@/lib/inbox'

const PRESENCE_TEXT = { ONLINE: 'online', AWAY: 'away', OFFLINE: 'offline' } as const

function snoozeTimes() {
  const inHour = new Date(Date.now() + 3600_000)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const nextWeek = new Date(tomorrow)
  nextWeek.setDate(nextWeek.getDate() + 6)
  return [
    { label: '1 hour', at: inHour },
    { label: 'Tomorrow 9:00', at: tomorrow },
    { label: 'Next week', at: nextWeek },
  ]
}

export function ConversationHeader({
  conversation: c,
  onBack,
  onToggleContact,
  contactButtonRef,
}: {
  conversation: Conversation
  onBack: () => void
  onToggleContact: () => void
  contactButtonRef?: Ref<HTMLButtonElement>
}) {
  const { tenantId, can, me } = useSession()
  const queryClient = useQueryClient()
  const now = useNow()
  const tags = useTags().data ?? []
  const members = useQuery({
    queryKey: keys.tenant(tenantId, 'inbox', 'presence'),
    queryFn: () => get<{ data: Presence[] }>('/inbox/presence').then((r) => r.data),
    staleTime: 15_000,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox') })
  }
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Something went wrong.'),
  })
  const base = `/conversations/${c.id}`
  const assign = (assigneeId: string | null) =>
    act.mutate(() => post(`${base}/assign`, { assigneeId }))
  const status = (s: Conversation['status'], snoozedUntil?: Date) =>
    act.mutate(() =>
      post(`${base}/status`, {
        status: s,
        ...(snoozedUntil ? { snoozedUntil: snoozedUntil.toISOString() } : {}),
      }),
    )
  const automation = (state: AutomationState) =>
    act.mutate(() => post(`${base}/automation-state`, { state }))
  const left = c.serviceWindow.isOpen ? windowLeft(c.serviceWindow.expiresAt, now) : null
  const canReply = can('inbox.reply')

  return (
    <div className="flex flex-col border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-3 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back to conversations"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <Avatar appearance="varied" name={displayName(c)} size="md" />
        <div className="flex min-w-40 flex-1 flex-col">
          <h2 className="truncate text-md font-semibold text-slate">{displayName(c)}</h2>
          <span className="font-mono text-sm text-muted">{c.contact.phoneE164}</span>
        </div>
        <span className="ml-1" title="WhatsApp 24-hour service window">
          <StatusBadge
            status={
              left
                ? c.serviceWindow.expiresAt &&
                  new Date(c.serviceWindow.expiresAt).getTime() - now <= 3600_000
                  ? 'EXPIRING'
                  : 'WINDOW_OPEN'
                : 'WINDOW_CLOSED'
            }
            label={left ? `Window open · ${left}` : 'Window closed'}
          />
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {can('inbox.assign_self') ? (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" size="sm">
                  <UserPlus aria-hidden="true" />
                  {c.assignee ? c.assignee.name : 'Assign'}
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                {c.assignee?.id !== me.user.id ? (
                  <DropdownItem onSelect={() => assign(me.user.id)}>Assign to me</DropdownItem>
                ) : null}
                {c.assignee && (c.assignee.id === me.user.id || can('inbox.reassign')) ? (
                  <DropdownItem onSelect={() => assign(null)}>Unassign</DropdownItem>
                ) : null}
                {can('inbox.reassign') ? (
                  <>
                    <DropdownSeparator />
                    <DropdownLabel>Team</DropdownLabel>
                    {(members.data ?? [])
                      .filter((m) => m.userId !== me.user.id)
                      .map((m) => (
                        <DropdownItem key={m.userId} onSelect={() => assign(m.userId)}>
                          {m.name}{' '}
                          <span className="text-xs text-muted">({PRESENCE_TEXT[m.status]})</span>
                        </DropdownItem>
                      ))}
                  </>
                ) : null}
              </DropdownContent>
            </Dropdown>
          ) : null}
          {canReply ? (
            c.status === 'RESOLVED' || c.status === 'SNOOZED' ? (
              <Button size="sm" variant="secondary" onClick={() => status('OPEN')}>
                Reopen
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={() => status('RESOLVED')}>
                  Resolve
                </Button>
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button size="sm" variant="ghost">
                      More
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent>
                    {c.status !== 'PENDING' ? (
                      <DropdownItem onSelect={() => status('PENDING')}>Mark pending</DropdownItem>
                    ) : (
                      <DropdownItem onSelect={() => status('OPEN')}>Mark open</DropdownItem>
                    )}
                    <DropdownLabel>Snooze until</DropdownLabel>
                    {snoozeTimes().map((s) => (
                      <DropdownItem key={s.label} onSelect={() => status('SNOOZED', s.at)}>
                        {s.label}
                      </DropdownItem>
                    ))}
                    {c.automationState === 'AUTOMATION_ACTIVE' ? (
                      <>
                        <DropdownSeparator />
                        <DropdownItem onSelect={() => automation('AGENT_TAKEOVER')}>
                          Take over from automation
                        </DropdownItem>
                        <DropdownItem onSelect={() => automation('AUTOMATION_PAUSED')}>
                          Pause automation
                        </DropdownItem>
                      </>
                    ) : null}
                    {tags.length ? (
                      <>
                        <DropdownSeparator />
                        <DropdownLabel>Tags</DropdownLabel>
                        {tags.map((t) => {
                          const on = c.tags.some((x) => x.id === t.id)
                          return (
                            <DropdownItem
                              key={t.id}
                              onSelect={() =>
                                act.mutate(() =>
                                  on
                                    ? del(`${base}/tags/${t.id}`)
                                    : put(`${base}/tags/${t.id}`, {}),
                                )
                              }
                            >
                              {on ? `Remove "${t.name}"` : `Add "${t.name}"`}
                            </DropdownItem>
                          )
                        })}
                      </>
                    ) : null}
                  </DropdownContent>
                </Dropdown>
              </>
            )
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            ref={contactButtonRef}
            aria-label="Contact details"
            onClick={onToggleContact}
          >
            <PanelRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {c.tags.length ? (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {c.tags.map((t) => (
            <Badge key={t.id} tone={TAG_TONE[t.color as keyof typeof TAG_TONE] ?? 'neutral'}>
              {t.name}
            </Badge>
          ))}
        </div>
      ) : null}
      {c.automationState !== 'AUTOMATION_ACTIVE' ? (
        <Alert
          tone="info"
          className="mx-3 mb-2"
          title={
            c.automationState === 'AGENT_TAKEOVER'
              ? 'An agent has taken over'
              : 'Automation is paused'
          }
          action={
            canReply ? (
              <Button size="sm" variant="secondary" onClick={() => automation('AUTOMATION_ACTIVE')}>
                Return to automation
              </Button>
            ) : null
          }
        >
          Automated messages won&apos;t be sent in this conversation.
        </Alert>
      ) : null}
    </div>
  )
}
