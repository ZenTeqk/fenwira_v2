import { describe, expect, it } from 'vitest'
import {
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
    expect(flattenLeaves(NAVIGATION)).toHaveLength(26)
    const hrefs = flattenLeaves(NAVIGATION).map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('shows only shipped modules and never empty groups', () => {
    const visible = visibleNavigation(false)
    for (const leaf of flattenLeaves(visible)) expect(leaf.phase).toBeLessThanOrEqual(SHIPPED_PHASE)
    for (const item of visible) if (item.children) expect(item.children.length).toBeGreaterThan(0)
    expect(visible.map((i) => i.id)).toEqual([
      'dashboard',
      'inbox',
      'contacts',
      'integrations',
      'settings',
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
      'Audit Logs',
    ])
  })

  it('reveals everything in preview mode', () => {
    expect(flattenLeaves(visibleNavigation(true))).toHaveLength(26)
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
      { label: 'Settings' },
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
})
