'use client'

import { Modal, ModalContent } from '@fenwira/ui'

const SHORTCUTS: Array<[string, string]> = [
  ['⌘K / Ctrl K', 'Search and jump to anything'],
  ['/ in the reply box', 'Insert a canned reply'],
  ['Enter / Shift Enter', 'Send / new line in the reply box'],
  ['Escape', 'Close a dialog, menu or search'],
  ['Delete / Backspace', 'Remove the selected step on the flow canvas'],
]

/** The keyboard-shortcuts dialog, opened from Help in the account menu. */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Keyboard shortcuts">
        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-baseline justify-between gap-4">
              <dt className="text-base text-fg">{what}</dt>
              <dd>
                <kbd className="rounded-sm border border-border-control px-1.5 font-mono text-xs text-fg">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </ModalContent>
    </Modal>
  )
}
