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
            'rounded-md border border-border-subtle bg-surface text-fg shadow-overlay font-sans text-base',
          description: 'text-fg-muted text-sm',
          actionButton: 'bg-action-primary text-action-primary-fg',
          cancelButton: 'bg-surface-muted text-fg',
          success: '[&_[data-icon]]:text-action-primary',
          error: '[&_[data-icon]]:text-status-error-fg',
          warning: '[&_[data-icon]]:text-status-warning',
          info: '[&_[data-icon]]:text-status-info-fg',
        },
      }}
    />
  )
}

export { toast }
