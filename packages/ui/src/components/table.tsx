import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

/** Semantic table in a horizontally scrollable container, so wide tables never scroll the page. */
export function Table({
  className,
  containerLabel,
  ...props
}: ComponentProps<'table'> & { containerLabel?: string }) {
  return (
    <div
      data-slot="table-container"
      role={containerLabel ? 'region' : undefined}
      aria-label={containerLabel}
      tabIndex={containerLabel ? 0 : undefined}
      className={cn(
        'relative w-full overflow-x-auto rounded-lg border border-border bg-surface',
        containerLabel && focusRing,
      )}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom border-collapse text-base', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-neutral-soft', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-background data-[state=selected]:bg-primary-soft',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-sm font-medium whitespace-nowrap text-slate-800',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle text-slate', className)} {...props} />
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('mt-3 text-sm text-muted', className)} {...props} />
}
