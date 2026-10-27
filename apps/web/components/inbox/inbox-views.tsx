import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
} from '@fenwira/ui'
import { Check, ListFilter } from 'lucide-react'

/** Filters beyond the tabs, status and unread (docs/INBOX.md → List filters and views). */
export type AdvancedFilter = 'none' | 'takeover'
const FILTERS: Array<{ id: AdvancedFilter; label: string }> = [
  { id: 'none', label: 'No extra filter' },
  { id: 'takeover', label: 'Agent takeover only' },
]

export function InboxFilterMenu({
  value,
  onChange,
}: {
  value: AdvancedFilter
  onChange: (value: AdvancedFilter) => void
}) {
  return (
    <Dropdown modal={false}>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={value === 'none' ? 'More filters' : 'More filters · Agent takeover only'}
          title="More filters"
        >
          <ListFilter aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent aria-label="More filters" align="end">
        <DropdownLabel>Show</DropdownLabel>
        {FILTERS.map(({ id, label }) => (
          <DropdownItem
            key={id}
            onSelect={() => onChange(id)}
            aria-current={value === id ? 'true' : undefined}
          >
            <span className="flex-1">{label}</span>
            {value === id ? (
              <Check aria-hidden="true" className="size-4 text-primary-strong" />
            ) : null}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
