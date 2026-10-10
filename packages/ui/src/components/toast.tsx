'use client'

import { Toaster as Sonner, toast } from 'sonner'

/** Mount once at the app root; call `toast.success(...)` etc. anywhere. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'rounded-md border border-border bg-surface text-slate shadow-overlay font-sans text-base',
          description: 'text-muted text-sm',
          actionButton: 'bg-primary-strong text-surface',
          cancelButton: 'bg-neutral-soft text-slate',
          success: '[&_[data-icon]]:text-primary-strong',
          error: '[&_[data-icon]]:text-danger-strong',
          warning: '[&_[data-icon]]:text-warning',
          info: '[&_[data-icon]]:text-info-strong',
        },
      }}
    />
  )
}

export { toast }
