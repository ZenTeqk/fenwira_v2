'use client'

import { Button, cn, focusRing } from '@fenwira/ui'
import Link from 'next/link'
import { ChevronDown, GitBranch, MessageCircle } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { activeModule, moduleHref, type NavItem, SECONDARY_MODULES } from '@/lib/navigation'

type SidebarNavProps = {
  items: NavItem[]
  pathname: string
  collapsed?: boolean
  onNavigate?: () => void
  /** Count pills by item id (e.g. unread conversations on Inbox). */
  badges?: Record<string, number>
  /**
   * `rail`: main modules scroll; Integrations, Billing and Settings stay pinned below a divider
   * (desktop sidebar). `stacked`: one flowing list with the same divider (mobile drawer).
   */
  layout?: 'rail' | 'stacked'
  /** Rendered after the main modules (e.g. workspace status). */
  afterPrimary?: ReactNode
}

const itemBase = cn(
  // 44px rows, 20px icons, 14px labels; the collapsed rail keeps the icon centred in 68px.
  'relative flex h-11 w-full items-center gap-3 rounded-sm px-3 text-base font-normal [&_svg]:size-5 [&_svg]:shrink-0',
  // Short background/colour change between states; none with reduced motion.
  'transition-colors duration-150 motion-reduce:transition-none',
  focusRing,
  'focus-visible:outline-offset-0',
)
// Hover uses the sidebar-specific step (stronger than the shared surface-hover in light) with
// charcoal label and icon. Idle icons are fg-subtle beside their label; with more contrast
// requested they take the label color.
const hover =
  'hover:bg-sidebar-item-hover hover:text-sidebar-item-hover-fg hover:[&_svg]:text-sidebar-item-hover-fg'
const inactive = cn(
  'text-fg-secondary [&_svg]:text-fg-subtle contrast-more:[&_svg]:text-fg-secondary',
  hover,
)
// Collapsed, the icon is the only visible identifier, so it needs 3:1 (WCAG 1.4.11): label color.
const inactiveCollapsed = cn('text-fg-secondary', hover)
// Selected: its own fill (darker on hover, never lost), semibold label, matching icon and the slim
// emerald bar on the leading edge. Focus stays the separate focus-visible ring.
const active = cn(
  'bg-sidebar-item-selected font-semibold text-sidebar-item-selected-fg [&_svg]:text-sidebar-item-selected-fg',
  'hover:bg-sidebar-item-selected-hover',
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
  layout = 'stacked',
  afterPrimary,
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
          {/* No tooltip: the rail expands to show labels, and the link's text is its name. */}
          {link}
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

  const utilities = secondary.length ? (
    <ul
      aria-label="Workspace"
      className="flex shrink-0 flex-col gap-0.5 border-t border-border-subtle pt-2"
    >
      {secondary.map(render)}
    </ul>
  ) : null
  // One landmark: main modules (Home → Analytics), then the workspace utilities.
  return layout === 'rail' ? (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-2">
      <div data-sidebar-scroll className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <ul className="flex flex-col gap-0.5">{primary.map(render)}</ul>
        {afterPrimary}
      </div>
      {utilities}
    </nav>
  ) : (
    <nav aria-label="Main" className="flex flex-col gap-2">
      <ul className="flex flex-col gap-0.5">{primary.map(render)}</ul>
      {afterPrimary}
      {utilities}
    </nav>
  )
}
