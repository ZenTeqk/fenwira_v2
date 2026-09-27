import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { signInAsNewOwner } from './support'

// WCAG 2.1 A + AA (docs/prompts/PHASE_02_DESIGN_SYSTEM.md acceptance: no AA violations).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS)
  if (include) builder.include(include)
  const results = await builder.analyze()
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }))
  expect(summary).toEqual([])
}

for (const path of ['/dev/ui', '/login', '/register', '/forgot-password']) {
  test(`${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoViolations(page)
  })
}

test('signed-in pages have no WCAG 2.1 AA violations', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAsNewOwner(page, 'ui-a11y')
  for (const path of [
    '/dashboard',
    '/settings/workspace',
    '/settings/team',
    '/settings/roles',
    '/settings/whatsapp',
    '/inbox',
    '/templates',
    '/templates/new',
    '/campaigns',
    '/campaigns/new',
    '/campaigns/analytics',
    '/contacts',
    '/contacts/segments',
    '/contacts/tags',
    '/contacts/imports',
    '/settings/security',
    '/settings/audit-logs',
    '/automations',
    '/automations/new',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expectNoViolations(page)
  }
})

// While a modal overlay is open, Radix aria-hides the page behind it and traps focus inside the
// overlay, so the background is unreachable. axe's aria-hidden-focus rule still flags the hidden
// background, so open overlays are audited on their own content. The page itself is covered by
// the closed-state tests above.
test('open overlays have no AA violations', async ({ page }) => {
  await page.goto('/dev/ui')
  await page.getByRole('button', { name: 'Open modal' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit contact' })).toBeVisible()
  await expectNoViolations(page, '[role="dialog"]')
  await page.keyboard.press('Escape')

  await page.getByTestId('dropdown-trigger').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoViolations(page, '[role="menu"]')
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: 'Error' }).click()
  await page.getByRole('radio', { name: 'Loading' }).click()
  await page.getByRole('radio', { name: 'Empty' }).click()
  await expectNoViolations(page)

  await page.getByRole('button', { name: 'Delete tag…' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expectNoViolations(page, '[role="alertdialog"]')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Open command palette' }).click()
  // The gallery's own palette uses the component's default placeholder.
  await expect(page.getByPlaceholder('Search or jump to…')).toBeVisible()
  await expectNoViolations(page, '[data-slot="command-palette"]')
})

test('mobile navigation drawer has no AA violations', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-a11y-mobile')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible()
  await expectNoViolations(page, '[role="dialog"]')
})
