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
export const SHIPPED_PHASE = 2

export type NavLeaf = { id: string; label: string; href: string; phase: number }
export type NavItem = NavLeaf & { icon: LucideIcon; children?: NavLeaf[] }

export const NAVIGATION: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', phase: 2, icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', href: '/inbox', phase: 7, icon: MessageSquare },
  {
    id: 'contacts',
    label: 'Contacts',
    href: '/contacts',
    phase: 6,
    icon: Users,
    children: [
      { id: 'contacts-all', label: 'All Contacts', href: '/contacts', phase: 6 },
      { id: 'contacts-segments', label: 'Segments', href: '/contacts/segments', phase: 6 },
      { id: 'contacts-tags', label: 'Tags', href: '/contacts/tags', phase: 6 },
      { id: 'contacts-imports', label: 'Imports', href: '/contacts/imports', phase: 6 },
    ],
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    href: '/campaigns',
    phase: 9,
    icon: Megaphone,
    children: [
      { id: 'campaigns-all', label: 'Campaigns', href: '/campaigns', phase: 9 },
      { id: 'campaigns-new', label: 'Create Campaign', href: '/campaigns/new', phase: 9 },
      { id: 'campaigns-analytics', label: 'Analytics', href: '/campaigns/analytics', phase: 9 },
    ],
  },
  {
    id: 'templates',
    label: 'Templates',
    href: '/templates',
    phase: 8,
    icon: FileText,
    children: [
      { id: 'templates-all', label: 'Templates', href: '/templates', phase: 8 },
      { id: 'templates-new', label: 'Create Template', href: '/templates/new', phase: 8 },
    ],
  },
  {
    id: 'automations',
    label: 'Automations',
    href: '/automations',
    phase: 10,
    icon: Workflow,
    children: [
      { id: 'automations-flows', label: 'Flows', href: '/automations', phase: 10 },
      { id: 'automations-builder', label: 'Flow Builder', href: '/automations/builder', phase: 10 },
    ],
  },
  { id: 'analytics', label: 'Analytics', href: '/analytics', phase: 11, icon: BarChart3 },
  {
    id: 'integrations',
    label: 'Integrations',
    href: '/integrations',
    phase: 4,
    icon: Plug,
    children: [
      { id: 'integrations-whatsapp', label: 'WhatsApp', href: '/integrations/whatsapp', phase: 4 },
      { id: 'integrations-webhooks', label: 'Webhooks', href: '/integrations/webhooks', phase: 11 },
      { id: 'integrations-api', label: 'API', href: '/integrations/api', phase: 11 },
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
      },
      { id: 'billing-wallet', label: 'Wallet', href: '/billing/wallet', phase: 11 },
      { id: 'billing-usage', label: 'Usage', href: '/billing/usage', phase: 11 },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    phase: 3,
    icon: Settings,
    children: [
      { id: 'settings-workspace', label: 'Workspace', href: '/settings/workspace', phase: 3 },
      { id: 'settings-team', label: 'Team', href: '/settings/team', phase: 3 },
      { id: 'settings-roles', label: 'Roles', href: '/settings/roles', phase: 3 },
      { id: 'settings-whatsapp', label: 'WhatsApp', href: '/settings/whatsapp', phase: 4 },
      { id: 'settings-security', label: 'Security', href: '/settings/security', phase: 3 },
      { id: 'settings-audit', label: 'Audit Logs', href: '/settings/audit-logs', phase: 3 },
    ],
  },
]

export const navPreviewEnabled = (): boolean => process.env.NEXT_PUBLIC_NAV_PREVIEW === 'true'

const shipped = (leaf: NavLeaf, preview: boolean) => preview || leaf.phase <= SHIPPED_PHASE

/** Visible navigation: unshipped leaves removed, empty groups dropped. */
export function visibleNavigation(preview: boolean, nav: NavItem[] = NAVIGATION): NavItem[] {
  return nav.flatMap((item) => {
    if (!item.children) return shipped(item, preview) ? [item] : []
    const children = item.children.filter((child) => shipped(child, preview))
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
  return leaf.group && leaf.group !== leaf.label
    ? [{ label: leaf.group }, { label: leaf.label }]
    : [{ label: leaf.label }]
}
