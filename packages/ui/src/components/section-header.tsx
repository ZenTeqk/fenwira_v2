import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type SectionHeaderProps = {
  title: string
  id?: string
  description?: ReactNode
  actions?: ReactNode
  /** Heading level; sections are h2 under the page h1, h3 inside a section. */
  as?: 'h2' | 'h3'
  className?: string
}

/** Section title (18/28) with an optional description and actions. */
export function SectionHeader({
  title,
  id,
  description,
  actions,
  as: Heading = 'h2',
  className,
}: SectionHeaderProps) {
  return (
    <div
      data-slot="section-header"
      className={cn('flex flex-wrap items-end justify-between gap-3', className)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading
          id={id}
          className={cn('font-semibold text-slate', Heading === 'h2' ? 'text-lg' : 'text-md')}
        >
          {title}
        </Heading>
        {description ? <p className="text-sm text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
