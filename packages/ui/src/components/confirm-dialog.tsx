'use client'

import { AlertDialog as AlertPrimitive } from 'radix-ui'
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { Button } from './button'

export type ConfirmOptions = {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive actions get the danger button (docs: every destructive action is confirmed). */
  destructive?: boolean
}

export type ConfirmDialogProps = ConfirmOptions & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Controlled confirmation dialog (Radix AlertDialog: focus starts on Cancel, Escape cancels). */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
}: ConfirmDialogProps) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-50 bg-slate/50" />
        <AlertPrimitive.Content
          data-slot="confirm-dialog"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
            'rounded-lg border border-border bg-surface p-5 shadow-overlay',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex flex-col gap-1">
            <AlertPrimitive.Title className="text-lg font-semibold text-slate">
              {title}
            </AlertPrimitive.Title>
            {description ? (
              <AlertPrimitive.Description className="text-base text-muted">
                {description}
              </AlertPrimitive.Description>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AlertPrimitive.Cancel>
            <AlertPrimitive.Action asChild>
              <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  )
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }
const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

/** Mount once near the root; then `const confirm = useConfirm(); if (await confirm({...})) …`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const settled = useRef(false)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settled.current = false
        setPending({ ...options, resolve })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    if (pending && !settled.current) {
      settled.current = true
      pending.resolve(ok)
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmDialog
          {...pending}
          open
          onConfirm={() => settle(true)}
          onOpenChange={(open) => {
            if (!open) {
              settle(false)
              setPending(null)
            }
          }}
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return confirm
}
