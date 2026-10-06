import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { API, customerWritesIn, ownerHeaders, signInAsNewOwner } from './support'

const WIDTHS = [1440, 1024, 768, 375]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Home is attention first, uses real activity and stays accessible at four widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'ui-ev2', 'Acme Retail')
  const customer = await customerWritesIn(page, owner, 'Can you help with my order?')
  for (const [path, name] of [
    ['campaigns', 'October customer update'],
    ['flows', 'Customer welcome'],
  ] as const) {
    const created = await page.request.post(`${API}/${path}`, {
      data: { name },
      headers: ownerHeaders(owner),
    })
    expect(created.status(), await created.text()).toBe(201)
  }
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Needs attention' })
      .getByText(/conversation waiting for an owner/),
  ).toBeVisible()
  const recent = page.getByRole('list', { name: 'Recent conversations' })
  await expect(recent.getByText(customer)).toBeVisible()
  await expect(page.getByRole('link', { name: 'October customer update' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Customer welcome', exact: true })).toBeVisible()
  const beforeMetrics = await page
    .getByRole('region', { name: 'Needs attention' })
    .evaluate((el) =>
      Boolean(
        el.compareDocumentPosition(document.querySelector('[aria-label="Workspace summary"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    )
  expect(beforeMetrics).toBe(true)
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true })
  }
  await recent.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/inbox\?c=/)
})

test('Home failures are explained rather than represented as empty activity', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-ev2-error')
  await page.route('**/api/v1/conversations?view=all&limit=5', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }),
    }),
  )
  await page.goto('/dashboard')
  await expect(page.getByRole('alert').getByText('Conversations couldn’t be loaded')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('New customer conversations will appear here.')).toHaveCount(0)
  await page.unroute('**/api/v1/conversations?view=all&limit=5')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('New customer conversations will appear here.')).toBeVisible()
})
