import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { API, customerWritesIn, ownerHeaders, resetRateLimits, signInAsNewOwner } from './support'

/** Design System v1 interactions (docs/design/UX_PATTERNS.md). */
test.beforeEach(() => resetRateLimits())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function expectNoViolations(page: Page, include?: string) {
  const b = new AxeBuilder({ page }).withTags(TAGS)
  if (include) b.include(include)
  const r = await b.analyze()
  expect(
    r.violations.map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target) })),
  ).toEqual([])
}

test('shell: modules in the sidebar, sub-pages as module tabs, status footer and help', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-shell', 'Shell Traders')
  await page.goto('/dashboard')
  const main = page.getByRole('navigation', { name: 'Main' })
  await expect(main.getByRole('link', { name: 'Contacts' })).toBeVisible()
  await expect(main.getByRole('link', { name: 'Segments' })).toHaveCount(0)
  // The top bar carries the workspace.
  await expect(
    page.getByRole('banner').getByRole('button', { name: /Current workspace: Shell Traders/ }),
  ).toBeVisible()

  await main.getByRole('link', { name: 'Contacts' }).click()
  const tabs = page.getByRole('navigation', { name: 'Contacts pages' })
  await expect(tabs.getByRole('link', { name: 'All contacts' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await tabs.getByRole('link', { name: 'Segments' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Segments' })).toBeVisible()
  await expect(main.getByRole('link', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')

  // Sidebar WhatsApp status (#114): a labelled link that changes once a number is connected.
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Not connected. View connections', exact: true }),
  ).toBeVisible()
  await customerWritesIn(page, owner, 'Hello')
  await page.reload()
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Connected. View connections', exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
    '⌘K / Ctrl K',
  )
})

test('Home: needs attention, real activity and secondary metrics', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-dash')
  await page.goto('/dashboard')
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention.getByText('Connect a WhatsApp number')).toBeVisible()
  await expect(page.locator('[data-slot="metric-card"]')).toHaveCount(4)
  await expectNoViolations(page)

  await customerWritesIn(page, owner, 'Is anyone there?')
  await page.reload()
  await expect(attention.getByText(/conversation waiting for an owner/)).toBeVisible()
  await expect(attention.getByText('Connect a WhatsApp number')).toHaveCount(0)
  await attention.getByRole('link', { name: 'Open inbox' }).click()
  await expect(page).toHaveURL(/\/inbox$/)
})

test('command palette finds records and starts create actions', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-cmd')
  const res = await page.request.post(`${API}/contacts`, {
    data: { name: 'Zainab Qureshi', phone: '+919876512345' },
    headers: ownerHeaders(owner),
  })
  expect(res.status()).toBe(201)
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('zainab')
  const option = page.getByRole('option', { name: /Zainab Qureshi/ })
  await expect(option).toBeVisible({ timeout: 15_000 })
  await expectNoViolations(page, '[data-slot="command-palette"]')
  await option.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Zainab Qureshi' })).toBeVisible()

  await page.keyboard.press('Control+k')
  await page.keyboard.type('new contact')
  await page.getByRole('option', { name: 'New contact' }).click()
  await expect(page.getByRole('dialog', { name: /New contact/ })).toBeVisible()
})

test('contacts: quick view drawer explains what can be sent', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-drawer')
  await page.request.post(`${API}/contacts`, {
    data: { name: 'Farah Ali', phone: '+919876500011' },
    headers: ownerHeaders(owner),
  })
  // Below 1280px Quick view opens the drawer; wider screens show the same content inline
  // (UX_PATTERNS → Contacts). Full eligibility sits in the keyboard disclosure.
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Actions for Farah Ali' }).click()
  await page.getByRole('menuitem', { name: 'Quick view' }).click()
  const drawer = page.getByRole('dialog', { name: 'Farah Ali' })
  await drawer.getByText('Eligibility and consent details', { exact: true }).click()
  const eligibility = drawer.getByRole('region', { name: 'Messaging eligibility' })
  await expect(eligibility).toContainText('Free-form replies')
  await expect(eligibility).toContainText("Can't send")
  await expect(eligibility).toContainText('This contact has not opted in to marketing messages.')
  await expectNoViolations(page, '[data-slot="drawer"]')
  await drawer.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Open full profile' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Farah Ali' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Messaging eligibility' })).toBeVisible()
})

test('automations: a starter recipe opens as a ready draft in the builder', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-recipe')
  await page.goto('/automations/new')
  await expectNoViolations(page)
  await page.getByTestId('template-keyword-reply').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Keyword reply' })).toBeVisible()
  await expect(page).toHaveURL(/\/automations\/[^/]+\/edit/)
  await expect(page.getByTestId(/^flow-node-/)).toHaveCount(3)
  await expect(page.getByRole('button', { name: /Setup checklist/ })).toBeVisible()
})
