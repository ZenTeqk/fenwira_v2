'use client'

import { Button, Drawer, DrawerContent, cn, focusRing } from '@fenwira/ui'
import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from 'react'

const query = '(min-width: 1280px)'
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** One inspection surface: inline with the library, modal only when the viewport needs it. */
export function TemplateContext({
  name,
  onClose,
  restoreFocus,
  children,
}: {
  name?: string
  onClose: () => void
  restoreFocus: () => void
  children: ReactNode
}) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (name && desktop) panel.current?.focus()
  }, [name, desktop])
  const close = () => {
    onClose()
    if (desktop) restoreFocus()
  }
  const content = (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="min-w-0 break-words text-base font-semibold">
          {name}
        </h2>
        {desktop ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close template details"
            onClick={close}
            className="size-8 shrink-0"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  )
  return (
    <>
      {name && desktop ? (
        <aside
          ref={panel}
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            'sticky top-4 max-h-screen w-80 shrink-0 overflow-y-auto rounded-lg border border-border bg-surface',
            focusRing,
          )}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.defaultPrevented &&
              !(event.target as Element).closest('[role="menu"]')
            ) {
              event.stopPropagation()
              close()
            }
          }}
        >
          {content}
        </aside>
      ) : null}
      <Drawer open={!!name && !desktop} onOpenChange={(open) => !open && !desktop && close()}>
        <DrawerContent
          title={name ?? 'Template details'}
          width="md"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (desktop) panel.current?.focus()
            else restoreFocus()
          }}
        >
          {!desktop ? <div className="-m-4">{content}</div> : null}
        </DrawerContent>
      </Drawer>
    </>
  )
}
