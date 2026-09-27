'use client'

import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export const Modal = DialogPrimitive.Root
export const ModalTrigger = DialogPrimitive.Trigger
export const ModalClose = DialogPrimitive.Close

const overlay = 'fixed inset-0 z-50 bg-slate/50'

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
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        data-slot="modal"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-xl border border-border bg-surface shadow-overlay',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-lg font-semibold text-slate">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              className={cn(
                'rounded-sm p-1 text-muted hover:bg-neutral-soft hover:text-slate',
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
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
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
  width?: 'sm' | 'md' | 'lg'
  /** `dark` matches the slate navigation (mobile sidebar). */
  tone?: 'light' | 'dark'
}

const drawerWidths = { sm: 'max-w-xs', md: 'max-w-md', lg: 'max-w-xl' } as const

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
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        data-slot="drawer"
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col shadow-overlay',
          tone === 'dark' ? 'border-slate bg-slate' : 'border-border bg-surface',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          drawerWidths[width],
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-4 border-b p-4',
            tone === 'dark' ? 'border-slate-800' : 'border-border',
          )}
        >
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title
              className={cn(
                'text-lg font-semibold',
                tone === 'dark' ? 'text-surface' : 'text-slate',
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description
                className={cn('text-sm', tone === 'dark' ? 'text-slate-400' : 'text-muted')}
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
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-surface'
                  : 'text-muted hover:bg-neutral-soft hover:text-slate',
                focusRing,
              )}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
