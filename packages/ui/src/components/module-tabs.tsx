import { type ComponentType, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type ModuleTab = { id: string; label: string; href: string; active: boolean }
type LinkLike = ComponentType<{
  href: string
  className?: string
  children: ReactNode
  'aria-current'?: 'page'
}>

/**
 * A module's sub-pages (Contacts → All · Segments · Tags · Imports). Links with aria-current, not
 * ARIA tabs: each is a separate page (UX_PATTERNS → Application shell).
 */
export function ModuleTabs({
  items,
  label,
  linkAs: LinkComp,
  className,
}: {
  items: ModuleTab[]
  label: string
  linkAs?: LinkLike
  className?: string
}) {
  const A: LinkLike =
    LinkComp ??
    (({ href, className: c, children, ...rest }) => (
      <a href={href} className={c} {...rest}>
        {children}
      </a>
    ))
  return (
    <nav
      data-slot="module-tabs"
      aria-label={label}
      className={cn('border-b border-border-subtle bg-surface', className)}
    >
      <ul className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 md:px-6">
        {items.map((t) => (
          <li key={t.id}>
            <A
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={cn(
                'relative flex h-11 items-center px-3 text-base font-medium whitespace-nowrap',
                t.active
                  ? 'text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-action-primary'
                  : 'text-fg-secondary hover:text-fg',
                focusRing,
                'focus-visible:-outline-offset-2',
              )}
            >
              {t.label}
            </A>
          </li>
        ))}
      </ul>
    </nav>
  )
}
