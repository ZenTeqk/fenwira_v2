import { describe, expect, it } from 'vitest'
import {
  activeModule,
  moduleHref,
  moduleTabs,
  NAVIGATION,
  SHIPPED_PHASE,
  breadcrumbsFor,
  findActiveLeaf,
  flattenLeaves,
  visibleNavigation,
} from '../lib/navigation'

describe('navigation', () => {
  it('matches the frozen information architecture', () => {
    expect(NAVIGATION.map((i) => i.label)).toEqual([
      'Dashboard',
      'Inbox',
      'Contacts',
      'Campaigns',
      'Templates',
      'Automations',
      'Analytics',
      'Integrations',
      'Billing',
      'Settings',
    ])
    expect(flattenLeaves(NAVIGATION)).toHaveLength(31)
    const hrefs = flattenLeaves(NAVIGATION).map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('shows only shipped modules and never empty groups', () => {
    const visible = visibleNavigation(false)
    // Only shipped phases, plus Phase 11 pages released early in their approved steps.
    for (const leaf of flattenLeaves(visible))
      if (leaf.phase > SHIPPED_PHASE)
        expect([
          'billing-wallet',
          'analytics-overview',
          'analytics-messaging',
          'analytics-campaigns',
          'analytics-inbox',
          'analytics-automations',
          'analytics-usage',
        ]).toContain(leaf.id)
    for (const item of visible) if (item.children) expect(item.children.length).toBeGreaterThan(0)
    expect(visible.map((i) => i.id)).toEqual([
      'dashboard',
      'inbox',
      'contacts',
      'campaigns',
      'templates',
      'automations',
      'analytics',
      'integrations',
      'billing',
      'settings',
    ])
    expect(visible.find((i) => i.id === 'billing')!.children!.map((c) => c.label)).toEqual([
      'Wallet',
    ])
    expect(visible.find((i) => i.id === 'automations')!.children!.map((c) => c.label)).toEqual([
      'Flows',
      'New automation',
    ])
    expect(visible.find((i) => i.id === 'templates')!.children!.map((c) => c.label)).toEqual([
      'Templates',
      'New template',
    ])
    expect(visible.find((i) => i.id === 'integrations')!.children!.map((c) => c.label)).toEqual([
      'WhatsApp',
    ])
    expect(visible.find((i) => i.id === 'settings')!.children!.map((c) => c.label)).toEqual([
      'Workspace',
      'Team',
      'Roles',
      'WhatsApp',
      'Security',
      'Audit logs',
    ])
  })

  it('reveals everything in preview mode', () => {
    expect(flattenLeaves(visibleNavigation(true))).toHaveLength(31)
  })

  it('keeps partially shipped groups with only their shipped children', () => {
    const nav = visibleNavigation(false, [
      {
        ...NAVIGATION.find((i) => i.id === 'integrations')!,
        children: [
          { id: 'a', label: 'WhatsApp', href: '/i/w', phase: 1 },
          { id: 'b', label: 'API', href: '/i/a', phase: 11 },
        ],
      },
    ])
    expect(nav[0]!.children!.map((c) => c.label)).toEqual(['WhatsApp'])
  })

  it('resolves the active leaf by longest prefix and builds breadcrumbs', () => {
    const nav = visibleNavigation(true)
    expect(findActiveLeaf('/contacts/segments/123', nav)?.id).toBe('contacts-segments')
    expect(findActiveLeaf('/contacts', nav)?.id).toBe('contacts-all')
    expect(breadcrumbsFor('/settings/team', nav)).toEqual([
      { label: 'Settings', href: '/settings/workspace' },
      { label: 'Team' },
    ])
    expect(breadcrumbsFor('/dashboard', nav)).toEqual([{ label: 'Dashboard' }])
    expect(breadcrumbsFor('/nowhere', nav)).toEqual([])
  })
  it('hides leaves the member lacks permission for', () => {
    const agent = visibleNavigation(false, NAVIGATION, ['workspace.read', 'team.read'])
    expect(agent.find((i) => i.id === 'settings')!.children!.map((c) => c.label)).toEqual([
      'Workspace',
      'Team',
      'Security',
    ])
  })

  it('opens modules on their first page and derives module tabs without create actions', () => {
    const visible = visibleNavigation(false)
    const campaigns = visible.find((i) => i.id === 'campaigns')!
    expect(moduleHref(campaigns)).toBe('/campaigns')
    expect(
      moduleTabs('/campaigns/analytics', visible).tabs.map((t) => [t.label, t.active]),
    ).toEqual([
      ['Campaigns', false],
      ['Analytics', true],
    ])
    // A single-page module (Templates, Automations) has no tabs; create pages aren't tabs.
    expect(moduleTabs('/templates/new', visible).tabs).toEqual([])
    expect(activeModule('/contacts/0192/anything', visible)?.id).toBe('contacts')
    expect(activeModule('/automations/abc/history', visible)?.id).toBe('automations')
    expect(breadcrumbsFor('/contacts/segments', visible)).toEqual([
      { label: 'Contacts', href: '/contacts' },
      { label: 'Segments' },
    ])
  })
})
