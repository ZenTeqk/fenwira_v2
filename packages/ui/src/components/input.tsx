import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const controlBase = [
  'w-full rounded-md border border-border-control bg-surface px-3 text-base text-fg',
  'placeholder:text-fg-muted transition-colors',
  'outline-none focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70',
  'aria-invalid:border-status-error aria-invalid:focus-visible:outline-status-error',
].join(' ')

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input data-slot="input" type={type} className={cn(controlBase, 'h-9', className)} {...props} />
  )
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlBase, 'min-h-20 resize-y py-2', className)}
      {...props}
    />
  )
}
