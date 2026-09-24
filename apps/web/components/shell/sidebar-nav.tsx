'use client'

import { cn, focusRing, Tooltip } from '@fenwira/ui'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { findActiveLeaf, type NavItem } from '@/lib/navigation'

type SidebarNavProps = {
  items: NavItem[]
  pathname: string
  collapsed?: boolean
  onNavigate?: () => void
}

const itemBase = cn(
  'relative flex h-9 w-full items-center gap-3 rounded-sm px-3 text-base font-medium transition-colors [&_svg]:size-4.5 [&_svg]:shrink-0',
  focusRing,
  'focus-visible:outline-offset-0',
)
const inactive = 'text-slate-400 hover:bg-slate-800 hover:text-surface'
// Active: slate-800 fill, white text, #00A884 indicator bar (non-text, docs/DESIGN_SYSTEM.md).
const active =
  'bg-slate-800 text-surface before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-full before:bg-primary'

export function SidebarNav({ items, pathname, collapsed = false, onNavigate }: SidebarNavProps) {
  const activeLeaf = findActiveLeaf(pathname, items)
  const activeGroup = items.find((item) =>
    item.children?.some((child) => child.id === activeLeaf?.id),
  )?.id
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeGroup ? { [activeGroup]: true } : {},
  )

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = item.icon
        if (!item.children) {
          const isActive = activeLeaf?.id === item.id
          const link = (
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                itemBase,
                isActive ? active : inactive,
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon aria-hidden="true" />
              {collapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          )
          return (
            <div key={item.id}>
              {collapsed ? (
                <Tooltip content={item.label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              )}
            </div>
          )
        }

        const groupActive = item.id === activeGroup
        if (collapsed) {
          // Collapsed rail: the group icon links to its first page; the tooltip names it.
          const first = item.children[0]!
          return (
            <div key={item.id}>
              <Tooltip content={item.label} side="right">
                <Link
                  href={first.href}
                  onClick={onNavigate}
                  aria-current={groupActive ? 'page' : undefined}
                  className={cn(itemBase, groupActive ? active : inactive, 'justify-center px-0')}
                >
                  <Icon aria-hidden="true" />
                  <span className="sr-only">{item.label}</span>
                </Link>
              </Tooltip>
            </div>
          )
        }

        const expanded = open[item.id] ?? false
        const panelId = `nav-group-${item.id}`
        return (
          <div key={item.id}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen((s) => ({ ...s, [item.id]: !expanded }))}
              className={cn(itemBase, groupActive ? 'text-surface' : inactive)}
            >
              <Icon aria-hidden="true" />
              <span className="flex-1 truncate text-left">{item.label}</span>
              <ChevronDown
                className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
            <ul id={panelId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5 pl-7">
              {item.children.map((child) => {
                const isActive = activeLeaf?.id === child.id
                return (
                  <li key={child.id}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(itemBase, 'h-8 text-sm', isActive ? active : inactive)}
                    >
                      <span className="truncate">{child.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
