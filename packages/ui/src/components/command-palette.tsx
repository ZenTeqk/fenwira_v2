'use client'

import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import { type ReactNode, useEffect } from 'react'
import { cn } from '../lib/cn'

export type CommandItem = {
  id: string
  label: string
  icon?: ReactNode
  /** Extra search terms (e.g. the parent group name). */
  keywords?: string[]
  shortcut?: string
  onSelect: () => void
}

export type CommandGroup = { heading: string; items: CommandItem[] }

export type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: CommandGroup[]
  placeholder?: string
  /** Controlled query, for groups loaded from the server as the user types. */
  search?: string
  onSearchChange?: (search: string) => void
  /** Shown under the input while server results load. */
  loading?: boolean
}

/** Opens on ⌘K / Ctrl+K anywhere on the page. */
export function useCommandPaletteShortcut(setOpen: (update: (open: boolean) => boolean) => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = 'Search or jump to…',
  search,
  onSearchChange,
  loading,
}: CommandPaletteProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate/50" />
        <DialogPrimitive.Content
          data-slot="command-palette"
          aria-describedby={undefined}
          className="fixed top-[15vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-overlay"
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Command palette</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <Command label="Command palette" loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted" aria-hidden="true" />
              <Command.Input
                placeholder={placeholder}
                value={search}
                onValueChange={onSearchChange}
                className="h-11 w-full bg-transparent text-base text-slate outline-none placeholder:text-slate-400"
              />
            </div>
            <Command.List className="max-h-96 overflow-y-auto p-1">
              {loading ? (
                <Command.Loading>
                  <p role="status" className="px-3 py-2 text-sm text-muted">
                    Searching…
                  </p>
                </Command.Loading>
              ) : null}
              <Command.Empty className="px-3 py-6 text-center text-base text-muted">
                No results.
              </Command.Empty>
              {groups.map((group) =>
                group.items.length === 0 ? null : (
                  <Command.Group
                    key={group.heading}
                    heading={group.heading}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.id}`}
                        keywords={item.keywords}
                        onSelect={() => {
                          onOpenChange(false)
                          item.onSelect()
                        }}
                        className={cn(
                          'flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-base text-slate select-none',
                          'data-[selected=true]:bg-primary-soft [&_svg]:size-4 [&_svg]:text-muted',
                        )}
                      >
                        {item.icon}
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut ? (
                          <kbd className="font-mono text-xs text-muted">{item.shortcut}</kbd>
                        ) : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ),
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
