'use client'

import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export const Modal = DialogPrimitive.Root
export const ModalTrigger = DialogPrimitive.Trigger
export const ModalClose = DialogPrimitive.Close

const overlay = 'fixed inset-0 z-50 bg-scrim/50'

/**
 * Radix returns focus to a Dialog `Trigger` on close; dialogs opened from ordinary buttons have
 * none, so focus fell to <body>. Return it to whatever opened the dialog, unless the consumer
 * handles close focus itself (calls preventDefault). A field with `autoFocus` is focused before
 * Radix records anything (it then skips the open event), so the last element focused outside any
 * dialog is the fallback.
 */
function useReturnFocus(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const opener = useRef<HTMLElement | null>(null)
  const lastOutside = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const outside = (el: Element | null): el is HTMLElement =>
      el instanceof HTMLElement &&
      el !== document.body &&
      !el.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')
    if (outside(document.activeElement)) lastOutside.current = document.activeElement
    const track = (event: FocusEvent) => {
      if (outside(event.target as Element | null)) lastOutside.current = event.target as HTMLElement
    }
    // Menu triggers don't take focus on pointer down, so remember the control that was pressed.
    const press = (event: PointerEvent) => {
      const control = (event.target as Element | null)?.closest(
        'button, a[href], input, select, textarea, [tabindex]',
      )
      if (outside(control ?? null)) lastOutside.current = control as HTMLElement
    }
    document.addEventListener('focusin', track, true)
    document.addEventListener('pointerdown', press, true)
    return () => {
      document.removeEventListener('focusin', track, true)
      document.removeEventListener('pointerdown', press, true)
    }
  }, [])
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement
      const content = event.currentTarget instanceof Node ? event.currentTarget : null
      opener.current =
        active instanceof HTMLElement && active !== document.body && !content?.contains(active)
          ? active
          : lastOutside.current
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event)
      // Radix skips the open event when a field autofocused first, so fall back.
      // A dialog opened from a menu item records that item, which is gone once the menu closes.
      const target = opener.current?.isConnected ? opener.current : lastOutside.current
      opener.current = null
      if (event.defaultPrevented || !target?.isConnected) return
      event.preventDefault()
      target.focus()
    },
  }
}

export type ModalContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /** Required: every modal has an accessible name. */
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  hideClose?: boolean
}

/** Centered dialog: focus-trapped, Escape closes, labelled by its title. */
export function ModalContent({
  className,
  title,
  description,
  footer,
  hideClose,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ModalContentProps) {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus)
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        data-slot="modal"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-xl border border-border-subtle bg-surface shadow-overlay',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
        {...returnFocus}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-lg font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              className={cn(
                'rounded-sm p-1 text-fg-muted hover:bg-surface-hover hover:text-fg',
                focusRing,
              )}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerClose = DialogPrimitive.Close

export type DrawerContentProps = ModalContentProps & {
  side?: 'left' | 'right'
  /** `half` takes half the viewport from 768px up and the full width below. */
  width?: 'sm' | 'md' | 'lg' | 'half'
  /** `dark` is the inverse surface (opposite lightness to the page). */
  tone?: 'light' | 'dark'
}

const drawerWidths = {
  sm: 'max-w-xs',
  md: 'max-w-md',
  lg: 'max-w-xl',
  half: 'max-w-none md:w-1/2',
} as const

/** Side sheet for record details and the mobile navigation. */
export function DrawerContent({
  className,
  title,
  description,
  footer,
  hideClose,
  side = 'right',
  width = 'md',
  tone = 'light',
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DrawerContentProps) {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus)
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        data-slot="drawer"
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col shadow-overlay',
          tone === 'dark' ? 'border-inverse bg-inverse' : 'border-border-subtle bg-surface',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          drawerWidths[width],
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
        {...returnFocus}
      >
        <div
          data-slot="drawer-header"
          className={cn(
            'flex items-start justify-between gap-4 border-b p-4',
            tone === 'dark' ? 'border-inverse-border' : 'border-border-subtle',
          )}
        >
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title
              className={cn(
                'text-lg font-semibold',
                tone === 'dark' ? 'text-inverse-fg' : 'text-fg',
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description
                className={cn(
                  'text-sm',
                  tone === 'dark' ? 'text-inverse-fg-muted' : 'text-fg-muted',
                )}
              >
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              className={cn(
                'rounded-sm p-1',
                tone === 'dark'
                  ? 'text-inverse-fg-muted hover:bg-inverse-hover hover:text-inverse-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                focusRing,
              )}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div data-slot="drawer-body" className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border-subtle p-4">{footer}</div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
