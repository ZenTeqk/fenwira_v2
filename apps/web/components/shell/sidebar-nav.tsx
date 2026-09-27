'use client'

import { cn, focusRing, Tooltip } from '@fenwira/ui'
import Link from 'next/link'
import { activeModule, moduleHref, type NavItem, SECONDARY_MODULES } from '@/lib/navigation'

type SidebarNavProps = {
  items: NavItem[]
  pathname: string
  collapsed?: boolean
  onNavigate?: () => void
  /** Count pills by item id (e.g. unread conversations on Inbox). */
  badges?: Record<string, number>
}

const itemBase = cn(
  'relative flex h-9 w-full items-center gap-3 rounded-sm px-3 text-base font-medium transition-colors [&_svg]:size-4.5 [&_svg]:shrink-0',
  focusRing,
  'focus-visible:outline-offset-0',
)
const inactive = 'text-slate-400 hover:bg-slate-800 hover:text-surface'
// Active: slate-800 fill, white text, #00A884 indicator bar (non-text, FENWIRA_DESIGN_SYSTEM → Module color usage).
const active =
  'bg-slate-800 text-surface before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-full before:bg-primary'

/**
 * Modules only (UX_PATTERNS → Application shell). A module's sub-pages are the ModuleTabs under
 * the top bar, not sidebar children. Operational modules first, then workspace administration.
 */
export function SidebarNav({
  items,
  pathname,
  collapsed = false,
  onNavigate,
  badges = {},
}: SidebarNavProps) {
  const current = activeModule(pathname, items)?.id
  const primary = items.filter((i) => !SECONDARY_MODULES.includes(i.id))
  const secondary = items.filter((i) => SECONDARY_MODULES.includes(i.id))

  const render = (item: NavItem) => {
    const Icon = item.icon
    const isActive = current === item.id
    const count = badges[item.id]
    const link = (
      <Link
        href={moduleHref(item)}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        className={cn(itemBase, isActive ? active : inactive, collapsed && 'justify-center px-0')}
      >
        <Icon aria-hidden="true" />
        {collapsed ? (
          <span className="sr-only">{item.label}</span>
        ) : (
          <span className="truncate">{item.label}</span>
        )}
        {count ? (
          <span
            className={cn(
              'rounded-full bg-primary-strong px-1.5 text-xs font-semibold text-surface',
              collapsed ? 'absolute top-0.5 right-1' : 'ml-auto',
            )}
          >
            {count > 99 ? '99+' : count}
            <span className="sr-only"> unread</span>
          </span>
        ) : null}
      </Link>
    )
    return (
      <li key={item.id}>
        {collapsed ? (
          <Tooltip content={item.label} side="right">
            {link}
          </Tooltip>
        ) : (
          link
        )}
      </li>
    )
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      <ul className="flex flex-col gap-0.5">{primary.map(render)}</ul>
      {secondary.length ? (
        <ul className="flex flex-col gap-0.5 border-t border-slate-800 pt-4">
          {secondary.map(render)}
        </ul>
      ) : null}
    </nav>
  )
}
