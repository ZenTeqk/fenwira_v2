import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

/**
 * Follow-ups, sales and response alerts in the browser (docs/FOLLOW_UPS_AND_SALES.md,
 * docs/RESPONSE_ALERTS.md). Isolated: the API is mocked, nothing is sent or stored.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const NOW = Date.now()
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const PERMISSIONS = [
  'workspace.read',
  'workspace.manage',
  'team.read',
  'inbox.read',
  'inbox.reply',
  'inbox.assign_self',
  'inbox.reassign',
  'inbox.read_all',
  'inbox.alerts.manage',
  'contacts.read',
  'followups.read',
  'followups.write',
  'followups.manage',
  'sales.read',
  'sales.write',
  'sales.stages.manage',
  'automations.read',
  'automations.write',
]
const stage = (id: string, name: string, outcome: string, position: number) => ({
  id,
  name,
  outcome,
  position,
  archived: false,
  opportunityCount: 1,
})
const STAGES = [
  stage('00000000-0000-7000-8000-0000000000a1', 'New enquiry', 'OPEN', 0),
  stage('00000000-0000-7000-8000-0000000000a2', 'Interested', 'OPEN', 1),
  stage('00000000-0000-7000-8000-0000000000a3', 'Quote sent', 'OPEN', 2),
  stage('00000000-0000-7000-8000-0000000000a4', 'Won', 'WON', 3),
  stage('00000000-0000-7000-8000-0000000000a5', 'Lost', 'LOST', 4),
]
const contact = {
  id: '00000000-0000-7000-8000-0000000000c1',
  name: 'Asha Rao',
  waProfileName: null,
  phoneE164: '+919800000001',
}
const followUp = (id: string, title: string, dueAt: string, extra: object = {}) => ({
  id,
  title,
  note: null,
  status: 'PENDING',
  dueAt,
  overdue: Date.parse(dueAt) <= NOW,
  needsReview: false,
  contact,
  conversationId: '00000000-0000-7000-8000-0000000000d1',
  opportunityId: null,
  salesStage: { id: STAGES[2]!.id, name: 'Quote sent', outcome: 'OPEN' },
  assignee: { id: 'preview-user', name: 'Preview owner' },
  createdBy: { id: 'preview-user', name: 'Preview owner' },
  completedAt: null,
  cancelledAt: null,
  version: 1,
  createdAt: iso(-600),
  ...extra,
})
const FOLLOW_UPS = [
  followUp('00000000-0000-7000-8000-0000000000f1', 'Send the revised quote', iso(-30), {
    needsReview: true,
  }),
  followUp('00000000-0000-7000-8000-0000000000f2', 'Confirm delivery date', iso(-5)),
]

async function mockApi(page: Page, { salesOn = true, overdue = 2 } = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api/v1', '')
    calls.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null })
    let data: unknown = []
    if (path === '/auth/me')
      data = {
        user: {
          id: 'preview-user',
          name: 'Preview owner',
          email: 'preview@fenwira.test',
          emailVerified: true,
          twoFactorEnabled: false,
          timezone: 'Asia/Kolkata',
          locale: 'en',
          createdAt: iso(-10000),
        },
        memberships: [
          {
            membershipId: 'preview-member',
            tenantId: '00000000-0000-7000-8000-0000000000e1',
            tenantName: 'Preview workspace',
            tenantSlug: 'preview',
            role: 'OWNER',
            permissions: PERMISSIONS,
            require2fa: false,
            salesFollowups: salesOn,
          },
        ],
        csrfToken: 'preview-csrf',
        features: { managedLaunch: false },
        session: null,
      }
    else if (path === '/workspace')
      data = {
        id: '00000000-0000-7000-8000-0000000000e1',
        name: 'Preview workspace',
        slug: 'preview',
        country: 'IN',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        require2fa: false,
        salesFollowupsEnabled: salesOn,
        createdAt: iso(-10000),
      }
    else if (path === '/follow-ups/summary') data = { overdue, today: 2, needsReview: 1 }
    else if (path === '/follow-ups/counts')
      data = { today: 2, overdue: 2, upcoming: 0, completed: 0 }
    else if (path === '/follow-ups' && req.method() === 'GET') {
      const tab = url.searchParams.get('tab')
      return route.fulfill({
        json: {
          data: tab === 'upcoming' || tab === 'completed' ? [] : FOLLOW_UPS,
          page: { nextCursor: null, hasMore: false, limit: 25 },
        },
      })
    } else if (/^\/follow-ups\/[^/]+\/complete$/.test(path))
      data = { ...FOLLOW_UPS[0], status: 'COMPLETED', version: 2 }
    else if (path === '/sales/stages') data = STAGES
    else if (path === '/team/members')
      data = [
        {
          membershipId: 'preview-member',
          userId: 'preview-user',
          name: 'Preview owner',
          email: 'preview@fenwira.test',
          role: 'OWNER',
          status: 'ACTIVE',
          twoFactorEnabled: false,
          joinedAt: iso(-10000),
        },
      ]
    else if (path === '/inbox/response-alerts')
      data = {
        enabled: false,
        unassignedMinutes: 5,
        responseMinutes: 15,
        escalationMinutes: 30,
        escalationUserIds: [],
        businessHours: {
          timezone: 'Asia/Kolkata',
          week: Array.from({ length: 7 }, (_, i) => ({
            closed: i > 4,
            open: '09:00',
            close: '18:00',
          })),
          holidays: [],
        },
        businessHoursConfigured: false,
        workspaceTimezone: 'Asia/Kolkata',
        enabledAt: null,
        issue: null,
      }
    else if (path === '/inbox/unread-count') data = { conversations: 0 }
    await route.fulfill({ json: { data, meta: { unread: 0 } } })
  })
  return calls
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 5).map((n) => n.target),
    })),
  ).toEqual([])
}

const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.addInitScript((t) => window.localStorage.setItem('fenwira.theme', t), theme)

test.describe('Follow-ups', () => {
  test('sits directly below Inbox with the overdue count, hidden at zero and when off', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockApi(page)
    await page.goto('/follow-ups')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: /Follow-ups 2 overdue/ })).toBeVisible()
    const links = nav.getByRole('link')
    // textContent: the collapsed rail hides labels visually but keeps them in the link.
    const labels = await links.evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    const at = (name: string) => labels.findIndex((l) => l.startsWith(name))
    expect(at('Follow-ups')).toBe(at('Inbox') + 1)
    await expect(nav.getByRole('link', { name: /Follow-ups 2 overdue/ })).toBeVisible()

    await page.unrouteAll()
    await mockApi(page, { overdue: 0 })
    await page.reload()
    await expect(nav.getByRole('link', { name: 'Follow-ups', exact: true })).toBeVisible()

    await page.unrouteAll()
    await mockApi(page, { salesOn: false })
    await page.goto('/dashboard')
    await expect(nav.getByRole('link', { name: /Follow-ups/ })).toHaveCount(0)
  })

  test('lists follow-ups with tabs, badges and actions, keyboard-operable', async ({ page }) => {
    const calls = await mockApi(page)
    await page.goto('/follow-ups')
    await expect(page.getByRole('heading', { name: 'Follow-ups', level: 1 })).toBeVisible()
    const table = page.getByRole('region', { name: 'Today follow-ups' })
    await expect(table.getByText('Send the revised quote')).toBeVisible()
    await expect(table.getByText('Overdue').first()).toBeVisible()
    await expect(table.getByText('Customer replied')).toBeVisible()
    await expect(
      table.getByRole('link', { name: /Open chat with Asha Rao/ }).first(),
    ).toHaveAttribute('href', /\/inbox\?c=/)
    // Tabs move with the arrow keys.
    await page.getByRole('tab', { name: /Today/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /Overdue/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /Upcoming/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText('No upcoming follow-ups')).toBeVisible()
    await page.getByRole('tab', { name: /Today/ }).click()
    // The row menu opens from the keyboard and completes with the follow-up's version.
    const menu = page.getByRole('button', { name: 'More actions for Send the revised quote' })
    await menu.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Complete' }).press('Enter')
    await expect
      .poll(() => calls.find((c) => c.method === 'POST' && c.path.endsWith('/complete'))?.body)
      .toEqual({ version: 1 })
    // Team scope toggle for managers.
    await page.getByRole('button', { name: 'Team follow-ups' }).click()
    await expect.poll(() => calls.some((c) => c.path === '/follow-ups')).toBe(true)
    await expect(page.getByRole('combobox', { name: 'Assigned to' })).toBeVisible()
  })

  test('opens the compact New follow-up form and closes with Escape', async ({ page }) => {
    await mockApi(page)
    await page.goto('/follow-ups')
    await page.getByRole('button', { name: 'New follow-up' }).click()
    const dialog = page.getByRole('dialog', { name: 'New follow-up' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Search customers by name or phone')).toBeVisible()
    await expect(dialog.getByLabel('Title')).toBeVisible()
    await expect(dialog.getByText('Workspace time (Asia/Kolkata)')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create follow-up' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New follow-up' })).toBeFocused()
  })

  for (const theme of ['light', 'dark'] as const)
    test(`passes axe and has no horizontal overflow in ${theme} theme`, async ({ page }) => {
      await setTheme(page, theme)
      await mockApi(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        for (const path of ['/follow-ups', '/settings/sales', '/settings/inbox']) {
          await page.goto(path)
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
          await page.waitForLoadState('networkidle')
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          )
          expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0)
          if (width === 1440) await expectNoViolations(page)
        }
      }
    })
})

test.describe('Settings', () => {
  test('stages can be reordered from the keyboard and response alerts start off', async ({
    page,
  }) => {
    const calls = await mockApi(page)
    await page.goto('/settings/sales')
    await expect(
      page.getByRole('list', { name: 'Active stages' }).getByRole('listitem'),
    ).toHaveCount(5)
    await page.getByRole('button', { name: 'Move Interested up' }).press('Enter')
    await expect
      .poll(() => calls.find((c) => c.method === 'PUT' && c.path === '/sales/stages/order')?.body)
      .toEqual({ ids: [STAGES[1]!.id, STAGES[0]!.id, STAGES[2]!.id, STAGES[3]!.id, STAGES[4]!.id] })
    await page.goto('/settings/inbox')
    await expect(page.getByRole('switch', { name: 'Send response alerts' })).not.toBeChecked()
    await expect(page.getByLabel('Still unassigned')).toHaveValue('5')
    await expect(page.getByLabel('No staff reply')).toHaveValue('15')
    await expect(page.getByLabel('Escalate')).toHaveValue('30')
    await expect(page.getByRole('link', { name: 'Edit business hours' })).toBeVisible()
  })
})
