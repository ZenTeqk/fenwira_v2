import { expect, type Page, test } from '@playwright/test'
import { signInAsNewOwner } from './support'

/** One shell for every module: same sidebar, top bar and title size; one row of module tabs. */
async function shellOf(page: Page, path: string) {
  await page.goto(path)
  const h1 = page.locator('main h1').first()
  await expect(h1).toBeVisible()
  const sidebar = await page.locator('aside').first().boundingBox()
  const search = await page.getByRole('button', { name: /Search and jump to/ }).boundingBox()
  return {
    sidebarWidth: Math.round(sidebar!.width),
    searchX: Math.round(search!.x),
    titleSize: await h1.evaluate((el) => getComputedStyle(el).fontSize),
    breadcrumbs: await page.locator('header nav[aria-label="Breadcrumb"]').count(),
    tabRows: await page.locator('nav[aria-label$="pages"]').count(),
  }
}

test('Billing and Settings use the same shell as Contacts, with one tab row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsNewOwner(page, 'shell')
  const contacts = await shellOf(page, '/contacts')
  for (const path of ['/billing/subscription', '/billing/invoices', '/settings/workspace']) {
    const s = await shellOf(page, path)
    expect(s.sidebarWidth, path).toBe(contacts.sidebarWidth)
    expect(s.searchX, path).toBe(contacts.searchX)
    expect(s.titleSize, path).toBe(contacts.titleSize)
    expect(s.breadcrumbs, path).toBe(contacts.breadcrumbs)
    if (path.startsWith('/billing')) expect(s.tabRows, path).toBeLessThanOrEqual(1)
  }
  await page.goto('/billing/invoices')
  await expect(page.locator('main h1').first()).toHaveText('Invoices')
  await expect(page.getByRole('link', { name: 'Usage', exact: true })).toHaveCount(0)
})
