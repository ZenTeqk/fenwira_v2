'use client'

import { Drawer, DrawerContent } from '@fenwira/ui'
import { type ReactNode } from 'react'

/**
 * Template preview sheet: half the page on the right (full width on phones), with the recipient
 * phone beside the details so the customer's view is the focus.
 */
export function TemplateContext({
  name,
  onClose,
  restoreFocus,
  preview,
  children,
}: {
  name?: string
  onClose: () => void
  restoreFocus: () => void
  /** The recipient phone preview, shown in its own column. */
  preview?: ReactNode
  children: ReactNode
}) {
  return (
    <Drawer open={!!name} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        title={name ?? 'Template details'}
        description="How customers see this template on WhatsApp"
        width="half"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <div className="@container">
          <div className="grid gap-6 @2xl:grid-cols-2">
            {preview ? (
              <section aria-label="WhatsApp preview" className="min-w-0 @2xl:order-2">
                {preview}
              </section>
            ) : null}
            <div className="flex min-w-0 flex-col gap-4">{children}</div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
