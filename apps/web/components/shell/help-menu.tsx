'use client'

import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
  Modal,
  ModalContent,
} from '@fenwira/ui'
import { CircleHelp, Keyboard, LayoutGrid } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const SHORTCUTS: Array<[string, string]> = [
  ['⌘K / Ctrl K', 'Search and jump to anything'],
  ['/ in the reply box', 'Insert a canned reply'],
  ['Enter / Shift Enter', 'Send / new line in the reply box'],
  ['Escape', 'Close a dialog, menu or search'],
  ['Delete / Backspace', 'Remove the selected step on the flow canvas'],
]

/** Help: keyboard shortcuts and (in development) the component gallery. */
export function HelpMenu({ galleryEnabled }: { galleryEnabled: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <CircleHelp aria-hidden="true" />
          </Button>
        </DropdownTrigger>
        <DropdownContent className="w-60">
          <DropdownLabel>Help</DropdownLabel>
          <DropdownItem onSelect={() => setOpen(true)}>
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </DropdownItem>
          {galleryEnabled ? (
            <DropdownItem onSelect={() => router.push('/dev/ui')}>
              <LayoutGrid aria-hidden="true" />
              Component gallery
            </DropdownItem>
          ) : null}
        </DropdownContent>
      </Dropdown>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent title="Keyboard shortcuts">
          <dl className="flex flex-col gap-2">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="flex items-baseline justify-between gap-4">
                <dt className="text-base text-slate">{what}</dt>
                <dd>
                  <kbd className="rounded-sm border border-border-strong px-1.5 font-mono text-xs text-slate">
                    {keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </ModalContent>
      </Modal>
    </>
  )
}
