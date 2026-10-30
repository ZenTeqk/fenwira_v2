'use client'

import { Search, X } from 'lucide-react'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'
import { Input } from './input'

export type SearchInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value' | 'type'> & {
  value: string
  onValueChange: (value: string) => void
  /** Accessible name, e.g. "Search contacts". */
  label: string
}

/** The one search box: icon, clear button, Escape clears (UX_PATTERNS → Tables). */
export function SearchInput({
  value,
  onValueChange,
  label,
  className,
  placeholder,
  ...props
}: SearchInputProps) {
  return (
    <div data-slot="search-input" className={cn('relative w-full sm:w-72', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onValueChange('')
          }
        }}
        className="h-9 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onValueChange('')}
          className={cn(
            'absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg',
            focusRing,
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
