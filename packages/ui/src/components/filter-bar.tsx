import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './button'

export type FilterBarProps = {
  children: ReactNode
  /** Trailing controls (column visibility, export). */
  end?: ReactNode
  /** How many filters differ from their defaults; shows "Clear filters" when > 0. */
  activeCount?: number
  onClear?: () => void
  className?: string
  label?: string
}

/** Toolbar above a collection: search first, then filters, then trailing controls. */
export function FilterBar({
  children,
  end,
  activeCount = 0,
  onClear,
  className,
  label = 'Filters',
}: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      role="group"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {children}
      {activeCount > 0 && onClear ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
          <span className="sr-only"> ({activeCount} active)</span>
        </Button>
      ) : null}
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  )
}
