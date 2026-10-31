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
// Idle icons are fg-subtle beside their label; with more contrast requested they take the label color.
const inactive = cn(
  'text-fg-secondary hover:bg-surface-hover hover:text-fg',
  '[&_svg]:text-fg-subtle contrast-more:[&_svg]:text-fg-secondary',
)
// Collapsed, the icon is the only visible identifier, so it needs 3:1 (WCAG 1.4.11): label color.
const inactiveCollapsed = 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
// Active: neutral selected fill, charcoal icon and label, slim emerald bar on the leading edge
// (action-primary clears 3:1 against the selected surface; the brand emerald does not).
const active = cn(
  'bg-surface-selected font-medium text-fg [&_svg]:text-fg',
  'before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-full before:bg-action-primary',
)

/** The same item treatment for other navigations (the operator console's sections). */
export const sidebarItemClass = (isActive: boolean) => cn(itemBase, isActive ? active : inactive)

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
          !collapsed && item.id === 'automations' && 'pr-10',
        )}
      >
        <Icon aria-hidden="true" />
        <span className="fw-sidebar-label truncate">{item.label}</span>
        {count ? (
          <span className="fw-sidebar-badge ml-auto rounded-full bg-action-primary px-1.5 text-xs font-semibold text-action-primary-fg">
            {count > 99 ? '99+' : count}
            <span className="sr-only"> unread</span>
          </span>
        ) : null}
      </Link>
    )
    return (
      <li key={item.id}>
        <div className="relative">
          <Tooltip content={item.label} side="right">
            {link}
          </Tooltip>
          {item.id === 'automations' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="fw-sidebar-disclosure absolute top-0.5 right-0.5 size-8 p-0 text-fg-secondary"
              aria-label={showAutomationChildren ? 'Collapse Automations' : 'Expand Automations'}
              aria-expanded={showAutomationChildren}
              aria-controls={automationChildrenId}
              tabIndex={collapsed ? -1 : undefined}
              aria-hidden={collapsed || undefined}
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
              'ml-5 mt-1 flex flex-col gap-1 border-l border-border-subtle pl-2',
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
                  className={cn(itemBase, child.selected ? active : inactive)}
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
