'use client'

import { type Conversation } from '@fenwira/contracts'
import { Button, Drawer, DrawerContent } from '@fenwira/ui'
import { ChevronRight } from 'lucide-react'
import { type Ref, type RefObject } from 'react'
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
  collapseButtonRef: Ref<HTMLButtonElement>
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /** "Jump to message" from Shared files. */
  onJump: (messageId: string) => void
}

/** Customer context docks on wide desktops; narrower viewports use the accessible drawer. */
export function ContactDetailsPanel({
  id,
  conversation: c,
  variant,
  open,
  onOpenChange,
  returnFocus,
  collapseButtonRef,
  tab,
  onTabChange,
  onJump,
}: PanelProps) {
  const body = (
    <ContactPane
      key={c.contact.id}
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
          title="Customer details"
          side="right"
          width="sm"
          // One view at a time on phones: the details take the whole screen.
          className="fw-inbox-customer-panel fw-inbox-theme fw-inbox-compact-icons fw-inbox-compact-type max-w-full md:max-w-xs"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus()
          }}
        >
          {body}
        </DrawerContent>
      </Drawer>
    )
  if (!open) return null
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className="fw-inbox-customer-panel flex min-h-0 min-w-0 w-80 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-4 py-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate">
          Customer details
        </h2>
        <Button
          ref={collapseButtonRef}
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close contact details"
          title="Close contact details"
          onClick={() => {
            onOpenChange(false)
          }}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  )
}
