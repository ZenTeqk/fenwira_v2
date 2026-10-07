import { type InboxView } from '@fenwira/contracts'
import { Button, cn } from '@fenwira/ui'
import { Bot, Inbox, Mail, User, UserRoundCheck, CheckCheck } from 'lucide-react'

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
  return (
    <nav
      aria-label="Inbox views"
      className="hidden h-full w-40 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-sidebar p-3 lg:flex"
    >
      <h2 className="px-2 pt-1 text-md font-semibold text-slate">Inbox</h2>
      <div className="flex flex-col gap-1" role="group" aria-label="Views">
        {INBOX_CHOICES.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn(
              'justify-start gap-2 px-2 font-normal',
              value === id && 'bg-primary-soft text-primary-strong',
            )}
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>
      <p className="border-t border-border px-2 pt-3 text-xs text-secondary">
        Shared conversations, assigned to people in your workspace.
      </p>
    </nav>
  )
}
