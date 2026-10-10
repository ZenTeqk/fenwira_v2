import { ChevronRight } from 'lucide-react'
import { type ComponentType, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type BreadcrumbItem = { label: string; href?: string }

/** Anything that renders an anchor (e.g. next/link); keeps @fenwira/ui framework-agnostic. */
export type LinkComponent = ComponentType<{ href: string; className?: string; children: ReactNode }>

export type BreadcrumbProps = {
  items: BreadcrumbItem[]
  linkAs?: LinkComponent
  className?: string
}

export function Breadcrumb({ items, linkAs: LinkAs, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1
          const linkClass = cn('rounded-sm hover:text-slate hover:underline', focusRing)
          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
              {last || !item.href ? (
                <span
                  className={cn(last && 'font-medium text-slate')}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : LinkAs ? (
                <LinkAs href={item.href} className={linkClass}>
                  {item.label}
                </LinkAs>
              ) : (
                <a href={item.href} className={linkClass}>
                  {item.label}
                </a>
              )}
              {last ? null : (
                <ChevronRight className="size-3.5 text-slate-400" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
