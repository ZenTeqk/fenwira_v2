'use client'

import { type Conversation } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  cn,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  focusRing,
  StatusBadge,
} from '@fenwira/ui'
import { type Ref } from 'react'
import { ArrowLeft, ChevronDown, Ellipsis, Paperclip, UserRound } from 'lucide-react'
import { useSession } from '@/components/session/session-provider'
import { useTags } from '@/lib/contacts'
import { displayName } from '@/lib/inbox'
import { formatPhone } from '@/lib/phone'
import {
  snoozeTimes,
  STATUS_LABEL,
  useConversationActions,
  usePresence,
} from './conversation-actions'

const PRESENCE_TEXT = { ONLINE: 'online', AWAY: 'away', OFFLINE: 'offline' } as const

/** Workflow status as a menu: Open / Waiting on customer / Snooze until… / Resolved. */
function StatusMenu({ c }: { c: Conversation }) {
  const actions = useConversationActions(c)
  const badge = <StatusBadge status={c.status} appearance="inline" label={STATUS_LABEL[c.status]} />
  if (!actions.can.reply) return badge
  return (
    <Dropdown>
      <DropdownTrigger
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-md border border-border-strong bg-surface px-2.5 hover:bg-neutral-soft',
          focusRing,
        )}
        aria-label={`Conversation status: ${STATUS_LABEL[c.status]}. Change status`}
      >
        {badge}
        <ChevronDown aria-hidden="true" className="size-3.5 text-secondary" />
      </DropdownTrigger>
      <DropdownContent align="start">
        {(['OPEN', 'PENDING'] as const).map((s) => (
          <DropdownItem key={s} disabled={c.status === s} onSelect={() => actions.setStatus(s)}>
            {STATUS_LABEL[s]}
          </DropdownItem>
        ))}
        <DropdownLabel>Snooze until</DropdownLabel>
        {snoozeTimes().map((s) => (
          <DropdownItem key={s.label} onSelect={() => actions.setStatus('SNOOZED', s.at)}>
            {s.label}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem
          disabled={c.status === 'RESOLVED'}
          onSelect={() => actions.setStatus('RESOLVED')}
        >
          {STATUS_LABEL.RESOLVED}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}

/**
 * Assignment: "Assign to me" while unassigned, otherwise the assignee's name; the menu holds
 * unassign and (with inbox.reassign) the workspace members.
 */
export function AssignControl({ c, className }: { c: Conversation; className?: string }) {
  const { me } = useSession()
  const actions = useConversationActions(c)
  const members = usePresence()
  const menu = actions.can.assignSelf || actions.can.unassign || actions.can.reassign
  // Without an assignment permission this is a read-only statement, never a dead button.
  if (!menu)
    return (
      <span
        className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm text-secondary', className)}
      >
        {c.assignee ? <Avatar appearance="varied" name={c.assignee.name} size="sm" /> : null}
        <span className="truncate">{c.assignee ? c.assignee.name : 'Unassigned'}</span>
      </span>
    )
  if (!c.assignee && !actions.can.reassign)
    return (
      <Button
        variant="secondary"
        className={className}
        loading={actions.pending}
        onClick={actions.assignToMe}
      >
        Assign to me
      </Button>
    )
  const label = c.assignee ? c.assignee.name : 'Assign to me'
  const trigger = (
    <Button
      variant="secondary"
      className={cn('max-w-48 min-w-0 gap-1.5', className)}
      aria-label={c.assignee ? `Assigned to ${c.assignee.name}. Change assignee` : 'Assign'}
      title={c.assignee ? `Assigned to ${c.assignee.name}` : 'Assign conversation'}
    >
      {c.assignee ? <Avatar appearance="varied" name={c.assignee.name} size="sm" /> : null}
      <span className="truncate">{label}</span>
      <ChevronDown aria-hidden="true" />
    </Button>
  )
  return (
    <Dropdown>
      <DropdownTrigger asChild>{trigger}</DropdownTrigger>
      <DropdownContent align="end">
        {actions.can.assignSelf ? (
          <DropdownItem onSelect={actions.assignToMe}>Assign to me</DropdownItem>
        ) : null}
        {actions.can.unassign ? (
          <DropdownItem onSelect={() => actions.assign(null)}>Unassign</DropdownItem>
        ) : null}
        {actions.can.reassign ? (
          <>
            <DropdownSeparator />
            <DropdownLabel>Workspace members</DropdownLabel>
            {(members.data ?? [])
              .filter((m) => m.userId !== me.user.id)
              .map((m) => (
                <DropdownItem
                  key={m.userId}
                  disabled={m.userId === c.assignee?.id}
                  onSelect={() => actions.assign(m.userId)}
                >
                  {m.name}{' '}
                  <span className="text-xs text-secondary">({PRESENCE_TEXT[m.status]})</span>
                </DropdownItem>
              ))}
          </>
        ) : null}
      </DropdownContent>
    </Dropdown>
  )
}

/**
 * Conversation header (~72px): identity and workflow status on the left; assign, resolve/reopen,
 * more and the contact-panel toggle on the right (docs/INBOX.md → Layout).
 */
export function ConversationHeader({
  conversation: c,
  onBack,
  onToggleContact,
  onSharedFiles,
  contactButtonRef,
  contactExpanded,
  contactControlsId,
  contactIsDrawer,
}: {
  conversation: Conversation
  onBack: () => void
  onToggleContact: () => void
  /** Opens the contact panel on Shared files. */
  onSharedFiles?: () => void
  contactButtonRef?: Ref<HTMLButtonElement>
  contactExpanded: boolean
  contactControlsId: string
  contactIsDrawer: boolean
}) {
  const tags = useTags().data ?? []
  const actions = useConversationActions(c)
  const name = displayName(c)
  const closed = c.status === 'RESOLVED' || c.status === 'SNOOZED'

  return (
    <div className="@container flex h-20 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 size-10 md:hidden"
        aria-label="Back to conversations"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <Avatar appearance="varied" name={name} size="lg" className="size-12 shrink-0 text-md" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="truncate text-lg font-semibold text-slate" title={name}>
          {name}
        </h2>
        <span className="truncate text-base text-secondary tabular-nums">
          {formatPhone(c.contact.phoneE164)}
        </span>
      </div>
      <div className="mr-auto hidden shrink-0 @md:block">
        <StatusMenu c={c} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <AssignControl c={c} className="hidden @2xl:inline-flex" />
        {actions.can.reply ? (
          closed ? (
            <Button variant="secondary" onClick={() => actions.setStatus('OPEN')}>
              Reopen
            </Button>
          ) : (
            <Button onClick={() => actions.setStatus('RESOLVED')}>Resolve</Button>
          )
        ) : null}
        <Dropdown>
          <DropdownTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="More conversation actions"
              title="More conversation actions"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            {onSharedFiles ? (
              <DropdownItem onSelect={onSharedFiles}>
                <Paperclip aria-hidden="true" className="size-4" />
                Shared files
              </DropdownItem>
            ) : null}
            {actions.can.reply && c.automationState === 'AUTOMATION_ACTIVE' ? (
              <>
                <DropdownSeparator />
                <DropdownItem onSelect={() => actions.setAutomation('AGENT_TAKEOVER')}>
                  Take over from automation
                </DropdownItem>
                <DropdownItem onSelect={() => actions.setAutomation('AUTOMATION_PAUSED')}>
                  Pause automation
                </DropdownItem>
              </>
            ) : null}
            {actions.can.reply && tags.length ? (
              <>
                <DropdownSeparator />
                <DropdownLabel>Tags</DropdownLabel>
                {tags.map((t) => {
                  const on = c.tags.some((x) => x.id === t.id)
                  return (
                    <DropdownItem key={t.id} onSelect={() => actions.toggleTag(t.id, on)}>
                      {on ? `Remove "${t.name}"` : `Add "${t.name}"`}
                    </DropdownItem>
                  )
                })}
              </>
            ) : null}
          </DropdownContent>
        </Dropdown>
        <Button
          variant="ghost"
          size="icon"
          ref={contactButtonRef}
          aria-label={contactExpanded ? 'Hide contact details' : 'Show contact details'}
          title={contactExpanded ? 'Hide contact details' : 'Show contact details'}
          aria-expanded={contactExpanded}
          aria-controls={contactControlsId}
          aria-haspopup={contactIsDrawer ? 'dialog' : undefined}
          onClick={onToggleContact}
        >
          <UserRound aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
