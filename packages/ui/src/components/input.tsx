import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const controlBase = [
  'w-full rounded-md border border-border-strong bg-surface px-3 text-base text-slate',
  'placeholder:text-muted transition-colors',
  'outline-none focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-strong',
  'disabled:cursor-not-allowed disabled:bg-neutral-soft disabled:opacity-70',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger',
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
