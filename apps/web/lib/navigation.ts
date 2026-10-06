import { type Permission } from '@fenwira/contracts'
import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Megaphone,
  Plug,
  Settings,
  FileText,
  Users,
  Workflow,
} from 'lucide-react'

/**
 * The frozen navigation (docs/ROADMAP.md) and the ONLY place that decides what is visible.
 * A module appears once its phase has shipped (`phase <= SHIPPED_PHASE`). Never show disabled
 * "coming soon" entries; NEXT_PUBLIC_NAV_PREVIEW=true (development only) reveals everything
 * with a placeholder page so the shell can be reviewed.
 */
export const SHIPPED_PHASE = 10

/** `permission`: hidden unless the member's role grants it (the API enforces it regardless). */
export type NavLeaf = {
  id: string
  label: string
  href: string
  phase: number
  permission?: Permission
  /**
   * Live before its phase closes. Phase 11 ships in approved steps (docs/plans/PHASE_11_PLAN.md
   * §8), so its pages appear one by one; remove the flag once SHIPPED_PHASE reaches 11.
   */
  early?: true
  /** `action` leaves (create …) go to the command palette's Create group, not the module tabs. */
  kind?: 'page' | 'action'
}
export type NavItem = NavLeaf & { icon: LucideIcon; children?: NavLeaf[] }

export const NAVIGATION: NavItem[] = [
  { id: 'dashboard', label: 'Home', href: '/dashboard', phase: 2, icon: LayoutDashboard },
  {
    id: 'inbox',
    label: 'Inbox',
    href: '/inbox',
    phase: 7,
    icon: MessageSquare,
    permission: 'inbox.read',
  },
  {
    id: 'contacts',
    label: 'Contacts',
    href: '/contacts',
    phase: 6,
    icon: Users,
    children: [
      {
        id: 'contacts-all',
        label: 'All contacts',
        href: '/contacts',
        phase: 6,
        permission: 'contacts.read',
      },
      {
        id: 'contacts-segments',
        label: 'Segments',
        href: '/contacts/segments',
        phase: 6,
        permission: 'contacts.read',
      },
      {
        id: 'contacts-tags',
        label: 'Tags',
        href: '/contacts/tags',
        phase: 6,
        permission: 'contacts.read',
      },
      {
        id: 'contacts-imports',
        label: 'Imports',
        href: '/contacts/imports',
        phase: 6,
        permission: 'contacts.import',
      },
    ],
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    href: '/campaigns',
    phase: 9,
    icon: Megaphone,
    children: [
      {
        id: 'campaigns-all',
        label: 'Campaigns',
        href: '/campaigns',
        phase: 9,
        permission: 'campaigns.read',
      },
      {
        id: 'campaigns-new',
        label: 'New campaign',
        href: '/campaigns/new',
        phase: 9,
        permission: 'campaigns.write',
        kind: 'action',
      },
      {
        id: 'campaigns-analytics',
        label: 'Analytics',
        href: '/campaigns/analytics',
        phase: 9,
        permission: 'campaigns.read',
      },
    ],
  },
  {
    id: 'templates',
    label: 'Templates',
    href: '/templates',
    phase: 8,
    icon: FileText,
    children: [
      {
        id: 'templates-all',
        label: 'Templates',
        href: '/templates',
        phase: 8,
        permission: 'templates.read',
      },
      {
        id: 'templates-new',
        label: 'New template',
        href: '/templates/new',
        phase: 8,
        permission: 'templates.write',
        kind: 'action',
      },
    ],
  },
  {
    id: 'automations',
    label: 'Automations',
    href: '/automations',
    phase: 10,
    icon: Workflow,
    children: [
      {
        id: 'automations-flows',
        label: 'Flows',
        href: '/automations',
        phase: 10,
        permission: 'automations.read',
      },
      {
        id: 'automations-builder',
        label: 'New automation',
        href: '/automations/new',
        phase: 10,
        permission: 'automations.write',
        kind: 'action',
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    phase: 11,
    icon: BarChart3,
    children: [
      {
        id: 'analytics-overview',
        label: 'Overview',
        href: '/analytics',
        phase: 11,
        permission: 'analytics.read',
        early: true,
      },
      {
        id: 'analytics-messaging',
        label: 'Messaging',
        href: '/analytics/messaging',
        phase: 11,
        permission: 'analytics.read',
        early: true,
      },
      {
        id: 'analytics-campaigns',
        label: 'Campaigns',
        href: '/analytics/campaigns',
        phase: 11,
        permission: 'analytics.read',
        early: true,
      },
      {
        id: 'analytics-inbox',
        label: 'Inbox',
        href: '/analytics/inbox',
        phase: 11,
        permission: 'analytics.read',
        early: true,
      },
      {
        id: 'analytics-automations',
        label: 'Automations',
        href: '/analytics/automations',
        phase: 11,
        permission: 'analytics.read',
        early: true,
      },
      {
        id: 'analytics-usage',
        label: 'Usage',
        href: '/analytics/usage',
        phase: 11,
        permission: 'billing.read',
        early: true,
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    href: '/integrations',
    phase: 4,
    icon: Plug,
    children: [
      {
        id: 'integrations-whatsapp',
        label: 'WhatsApp',
        href: '/integrations/whatsapp',
        phase: 4,
        permission: 'whatsapp.read',
      },
      {
        id: 'integrations-webhooks',
        label: 'Webhooks',
        href: '/integrations/webhooks',
        phase: 11,
        permission: 'integrations.manage',
      },
      {
        id: 'integrations-api',
        label: 'API',
        href: '/integrations/api',
        phase: 11,
        permission: 'integrations.manage',
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    href: '/billing',
    phase: 11,
    icon: CreditCard,
    children: [
      {
        id: 'billing-subscription',
        label: 'Subscription',
        href: '/billing/subscription',
        phase: 11,
        permission: 'billing.read',
        early: true,
      },
      {
        id: 'billing-wallet',
        label: 'Wallet',
        href: '/billing/wallet',
        phase: 11,
        permission: 'billing.read',
        early: true,
      },
      {
        id: 'billing-usage',
        label: 'Usage',
        href: '/billing/usage',
        phase: 11,
        permission: 'billing.read',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    phase: 3,
    icon: Settings,
    children: [
      {
        id: 'settings-workspace',
        label: 'Workspace',
        href: '/settings/workspace',
        phase: 3,
        permission: 'workspace.read',
      },
      {
        id: 'settings-team',
        label: 'Team',
        href: '/settings/team',
        phase: 3,
        permission: 'team.read',
      },
      {
        id: 'settings-roles',
        label: 'Roles',
        href: '/settings/roles',
        phase: 3,
        permission: 'roles.read',
      },
      {
        id: 'settings-whatsapp',
        label: 'WhatsApp',
        href: '/settings/whatsapp',
        phase: 4,
        permission: 'whatsapp.read',
      },
      { id: 'settings-security', label: 'Security', href: '/settings/security', phase: 3 },
      {
        id: 'settings-audit',
        label: 'Audit logs',
        href: '/settings/audit-logs',
        phase: 3,
        permission: 'audit.view',
      },
    ],
  },
]

export const navPreviewEnabled = (): boolean => process.env.NEXT_PUBLIC_NAV_PREVIEW === 'true'

const visible = (leaf: NavLeaf, preview: boolean, permissions?: readonly Permission[]) =>
  (preview || leaf.phase <= SHIPPED_PHASE || leaf.early === true) &&
  (!leaf.permission || !permissions || permissions.includes(leaf.permission))

/**
 * Visible navigation: unshipped leaves and leaves the member lacks permission for are removed;
 * empty groups are dropped. `permissions` undefined = don't filter by permission.
 */
export function visibleNavigation(
  preview: boolean,
  nav: NavItem[] = NAVIGATION,
  permissions?: readonly Permission[],
): NavItem[] {
  return nav.flatMap((item) => {
    if (!item.children) return visible(item, preview, permissions) ? [item] : []
    const children = item.children.filter((child) => visible(child, preview, permissions))
    return children.length > 0 ? [{ ...item, children }] : []
  })
}

/** Every navigable leaf (items without children plus all children), in menu order. */
export type FlatLeaf = NavLeaf & { group?: string }

export function flattenLeaves(nav: NavItem[]): FlatLeaf[] {
  return nav.flatMap((item): FlatLeaf[] =>
    item.children
      ? item.children.map((child) => ({ ...child, group: item.label }))
      : [{ id: item.id, label: item.label, href: item.href, phase: item.phase }],
  )
}

/** Longest-prefix match of a pathname to a leaf, for active state and breadcrumbs. */
export function findActiveLeaf(
  pathname: string,
  nav: NavItem[],
): (NavLeaf & { group?: string }) | undefined {
  const matches = flattenLeaves(nav).filter(
    (leaf) => pathname === leaf.href || pathname.startsWith(`${leaf.href}/`),
  )
  return matches.sort((a, b) => b.href.length - a.href.length)[0]
}

/** Any leaf in the full (unfiltered) navigation, for placeholder pages in preview mode. */
export function findPlannedLeaf(pathname: string): (NavLeaf & { group?: string }) | undefined {
  return flattenLeaves(NAVIGATION).find((leaf) => leaf.href === pathname)
}

export function breadcrumbsFor(
  pathname: string,
  nav: NavItem[],
): Array<{ label: string; href?: string }> {
  const leaf = findActiveLeaf(pathname, nav)
  if (!leaf) return []
  const mod = activeModule(pathname, nav)
  // The module links to its first page; the sub-page itself is shown by the module tabs.
  return mod && mod.label !== leaf.label
    ? [{ label: mod.label, href: moduleHref(mod) }, { label: leaf.label }]
    : [{ label: leaf.label }]
}

/** Workspace administration, listed under a divider in the sidebar. */
export const SECONDARY_MODULES = ['integrations', 'billing', 'settings']

/** Where a module's sidebar link goes: its first visible sub-page, or itself. */
export const moduleHref = (item: NavItem): string =>
  item.children?.find((c) => c.kind !== 'action')?.href ?? item.children?.[0]?.href ?? item.href

/** The module that owns a pathname (its own href or any sub-page, longest match). */
export function activeModule(pathname: string, nav: NavItem[]): NavItem | undefined {
  const leaf = findActiveLeaf(pathname, nav)
  if (leaf) return nav.find((i) => i.id === leaf.id || i.children?.some((c) => c.id === leaf.id))
  return nav.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
}

/** A module's sub-pages as tabs; empty when the module has a single page. */
export function moduleTabs(pathname: string, nav: NavItem[]) {
  const mod = activeModule(pathname, nav)
  const pages = (mod?.children ?? []).filter((c) => c.kind !== 'action')
  if (pages.length < 2) return { module: mod, tabs: [] }
  const leaf = findActiveLeaf(pathname, nav)
  return {
    module: mod,
    tabs: pages.map((c) => ({ id: c.id, label: c.label, href: c.href, active: c.id === leaf?.id })),
  }
}
