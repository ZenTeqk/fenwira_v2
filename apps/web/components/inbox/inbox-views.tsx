import { type InboxView } from '@fenwira/contracts'
import { Button, Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@fenwira/ui'
import { Bot, Inbox, Mail, User, UserRoundCheck, CheckCheck, Check, ListFilter } from 'lucide-react'

export type ViewChoice = InboxView | 'unread'
export const INBOX_CHOICES = [
  { id: 'all', label: 'All', icon: Inbox },
  { id: 'mine', label: 'Mine', icon: User },
  { id: 'unassigned', label: 'Unassigned', icon: UserRoundCheck },
  { id: 'unread', label: 'Unread', icon: Mail },
  { id: 'takeover', label: 'Takeover', icon: Bot },
  { id: 'resolved', label: 'Resolved', icon: CheckCheck },
] satisfies Array<{ id: ViewChoice; label: string; icon: typeof Inbox }>

/** Individual-user views only; Unread uses the existing server filter, never a new queue. */
export function InboxViews({
  value,
  onChange,
}: {
  value: ViewChoice
  onChange: (choice: ViewChoice) => void
}) {
  const selected = INBOX_CHOICES.find((choice) => choice.id === value)!
  return (
    <Dropdown modal={false}>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 sm:size-9"
          aria-label={`Inbox views · ${selected.label}`}
          title="Choose conversation view"
        >
          <ListFilter aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent aria-label="Inbox views" align="end">
        {INBOX_CHOICES.map(({ id, label, icon: Icon }) => (
          <DropdownItem
            key={id}
            onSelect={() => onChange(id)}
            aria-current={value === id ? 'true' : undefined}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="flex-1">{id === 'all' ? 'All conversations' : label}</span>
            {value === id ? (
              <Check aria-hidden="true" className="size-4 text-primary-strong" />
            ) : null}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
