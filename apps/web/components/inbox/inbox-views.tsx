import { type ConversationCounts } from '@fenwira/contracts'
import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@fenwira/ui'
import { Check, Inbox, ListFilter, User, UserRoundCheck } from 'lucide-react'

export type InboxView = keyof ConversationCounts
export const INBOX_VIEWS: Array<{
  id: InboxView
  label: string
  title: string
  icon: typeof Inbox
}> = [
  { id: 'all', label: 'All', title: 'All conversations', icon: Inbox },
  { id: 'mine', label: 'Mine', title: 'Mine', icon: User },
  { id: 'unassigned', label: 'Unassigned', title: 'Unassigned', icon: UserRoundCheck },
]

/** Filters beyond status and unread (docs/INBOX.md → List filters and views). */
export type AdvancedFilter = 'none' | 'takeover'

/**
 * The list's Filter menu: the view (All / Mine / Unassigned, with server counts for the active
 * search, status and unread filters) and the agent-takeover filter.
 */
export function InboxFilterMenu({
  view,
  onViewChange,
  counts,
  advanced,
  onAdvancedChange,
}: {
  view: InboxView
  onViewChange: (view: InboxView) => void
  /** Hidden while a filter the counts don't cover (takeover) is on. */
  counts: ConversationCounts | undefined
  advanced: AdvancedFilter
  onAdvancedChange: (value: AdvancedFilter) => void
}) {
  const current = INBOX_VIEWS.find((v) => v.id === view)!
  const label = `Filter · ${current.title}${advanced === 'takeover' ? ' · Agent takeover' : ''}`
  return (
    <Dropdown modal={false}>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} title={label}>
          <ListFilter aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent aria-label="Filter conversations" align="end" className="w-60">
        <DropdownLabel>View</DropdownLabel>
        {INBOX_VIEWS.map(({ id, title, icon: Icon }) => (
          <DropdownItem
            key={id}
            onSelect={() => onViewChange(id)}
            aria-current={view === id ? 'true' : undefined}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="flex-1">{title}</span>
            {counts ? ' ' : null}
            {counts ? (
              <span className="text-sm text-secondary tabular-nums">{counts[id]}</span>
            ) : null}
            {view === id ? (
              <Check aria-hidden="true" className="size-4 text-primary-strong" />
            ) : (
              <span aria-hidden="true" className="size-4" />
            )}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => onAdvancedChange(advanced === 'takeover' ? 'none' : 'takeover')}
          aria-current={advanced === 'takeover' ? 'true' : undefined}
        >
          <span className="flex-1">Agent takeover only</span>
          {advanced === 'takeover' ? (
            <Check aria-hidden="true" className="size-4 text-primary-strong" />
          ) : null}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
