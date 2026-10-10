import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** Surface card: white, bordered, no shadow (docs/DESIGN_SYSTEM.md → Elevation). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-lg border border-border bg-surface', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />
}

/** Card heading. `as` sets the level so pages keep a correct outline (h1 → h2 → h3). */
export function CardTitle({
  className,
  as: Heading = 'h3',
  ...props
}: ComponentProps<'h3'> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Heading className={cn('text-md font-semibold text-slate', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)}
      {...props}
    />
  )
}
