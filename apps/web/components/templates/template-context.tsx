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
          <div className="flex flex-col gap-6 @xl:flex-row @xl:items-start">
            {preview ? (
              // The phone stands on a tinted stage that stays in view while the details scroll.
              <section
                aria-label="WhatsApp preview"
                className="fw-preview-stage flex min-w-0 shrink-0 justify-center rounded-xl bg-primary-soft px-5 py-6 @xl:sticky @xl:top-0 @xl:w-80"
              >
                <div className="w-full max-w-72">{preview}</div>
              </section>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
