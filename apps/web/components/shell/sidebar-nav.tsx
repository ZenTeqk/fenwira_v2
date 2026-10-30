'use client'

import { Button, cn, focusRing, Tooltip } from '@fenwira/ui'
import Link from 'next/link'
import { ChevronDown, GitBranch, MessageCircle } from 'lucide-react'
import { useId, useState } from 'react'
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
  'relative flex h-9 w-full items-center gap-3 rounded-sm px-3 text-base font-normal transition-colors [&_svg]:size-4.5 [&_svg]:shrink-0',
  focusRing,
  'focus-visible:outline-offset-0',
)
// Idle icons are slate-400 beside their label; with more contrast requested they take the label color.
const inactive = cn(
  'text-secondary hover:bg-neutral-soft hover:text-slate',
  '[&_svg]:text-slate-400 contrast-more:[&_svg]:text-secondary',
)
// Collapsed, the icon is the only visible identifier, so it needs 3:1 (WCAG 1.4.11): label color.
const inactiveCollapsed = 'text-secondary hover:bg-neutral-soft hover:text-slate'
// Active: subtle emerald fill, strong emerald icon and label, 3px primary bar on the leading edge.
const active = cn(
  'bg-primary-soft font-medium text-primary-strong',
  'before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-full before:bg-primary',
)

/**
 * Module navigation, with the reference-approved Workflows / Reply Studio children when
 * Automations is open. Other modules retain their own module tabs.
 */
export function SidebarNav({
  items,
  pathname,
  collapsed = false,
  onNavigate,
  badges = {},
}: SidebarNavProps) {
  const current = activeModule(pathname, items)?.id
  const [automationsExpanded, setAutomationsExpanded] = useState<boolean | null>(null)
  const automationChildrenId = useId()
  const showAutomationChildren = !collapsed && (automationsExpanded ?? current === 'automations')
  const primary = items.filter((i) => !SECONDARY_MODULES.includes(i.id))
  const secondary = items.filter((i) => SECONDARY_MODULES.includes(i.id))

  const render = (item: NavItem) => {
    const Icon = item.icon
    const isActive = current === item.id
    const count = badges[item.id]
    const link = (
      <Link
        href={moduleHref(item)}
        onClick={() => {
          if (item.id === 'automations') setAutomationsExpanded(true)
          onNavigate?.()
        }}
        aria-current={
          isActive && (item.id !== 'automations' || !showAutomationChildren) ? 'page' : undefined
        }
        className={cn(
          itemBase,
          isActive ? active : collapsed ? inactiveCollapsed : inactive,
          collapsed && 'justify-center px-0',
          !collapsed && item.id === 'automations' && 'pr-10',
        )}
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
        <div className="relative">
          {collapsed ? (
            <Tooltip content={item.label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          )}
          {!collapsed && item.id === 'automations' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-0.5 right-0.5 size-8 p-0 text-secondary"
              aria-label={showAutomationChildren ? 'Collapse Automations' : 'Expand Automations'}
              aria-expanded={showAutomationChildren}
              aria-controls={automationChildrenId}
              onClick={() => setAutomationsExpanded(!showAutomationChildren)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'transition-transform motion-reduce:transition-none',
                  !showAutomationChildren && '-rotate-90',
                )}
              />
            </Button>
          ) : null}
        </div>
        {!collapsed && item.id === 'automations' ? (
          <ul
            id={automationChildrenId}
            hidden={!showAutomationChildren}
            aria-label="Automation sections"
            className={cn(
              'ml-5 mt-1 flex flex-col gap-1 border-l border-border pl-2',
              !showAutomationChildren && 'hidden',
            )}
          >
            {[
              {
                label: 'Workflows',
                href: '/automations/workflows',
                icon: GitBranch,
                selected: isActive && !pathname.includes('/reply-studio'),
              },
              {
                label: 'Reply Studio',
                href: '/automations/reply-studio/auto-replies',
                icon: MessageCircle,
                selected: isActive && pathname.includes('/reply-studio'),
              },
            ].map((child) => (
              <li key={child.label}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={child.selected ? 'page' : undefined}
                  className={cn(
                    itemBase,
                    child.selected ? 'bg-primary-soft font-medium text-primary-strong' : inactive,
                  )}
                >
                  <child.icon aria-hidden="true" />
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    // One continuous list: workspace modules (Integrations, Billing, Settings) follow straight on.
    <nav aria-label="Main">
      <ul className="flex flex-col gap-0.5">{[...primary, ...secondary].map(render)}</ul>
    </nav>
  )
}
