'use client'

import { type Conversation } from '@fenwira/contracts'
import { Button, Drawer, DrawerContent } from '@fenwira/ui'
import { X } from 'lucide-react'
import { type RefObject } from 'react'
import { ContactPane, type PanelTab } from './contact-pane'
import { SharedFiles } from './shared-files'

type PanelProps = {
  id: string
  conversation: Conversation
  /** Inline (wide screens) or an overlay drawer; the content is the same. */
  variant: 'inline' | 'overlay'
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Focus returns here when the panel closes. */
  returnFocus: RefObject<HTMLButtonElement | null>
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /** "Jump to message" from Shared files. */
  onJump: (messageId: string) => void
}

/** Contact details beside the chat (docs/INBOX.md → Layout): inline ≥1440px, overlay below. */
export function ContactDetailsPanel({
  id,
  conversation: c,
  variant,
  open,
  onOpenChange,
  returnFocus,
  tab,
  onTabChange,
  onJump,
}: PanelProps) {
  const body = (
    <ContactPane
      contactId={c.contact.id}
      conversation={c}
      tab={tab}
      onTabChange={onTabChange}
      files={<SharedFiles conversationId={c.id} onJump={onJump} />}
    />
  )
  if (variant === 'overlay')
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          id={id}
          title="Contact details"
          side="right"
          width="sm"
          // One view at a time on phones: the details take the whole screen.
          className="max-w-full md:max-w-xs"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus()
          }}
        >
          {/* The drawer pads its body; the pane brings its own spacing. */}
          <div className="-m-4">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  if (!open) return null
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex min-h-0 w-78 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5 pt-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate">
          Contact details
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close contact details"
          title="Close contact details"
          onClick={() => {
            onOpenChange(false)
            returnFocus.current?.focus()
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  )
}
