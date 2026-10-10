import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { customerWritesIn, signInAsNewOwner } from './support'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const VIEWS: Array<[string, string]> = [
  ['/analytics', 'Analytics'],
  ['/analytics/messaging', 'Messaging'],
  ['/analytics/campaigns', 'Campaign analytics'],
  ['/analytics/inbox', 'Inbox analytics'],
  ['/analytics/automations', 'Automation analytics'],
  ['/analytics/usage', 'Usage'],
]

async function noViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
}

test('Analytics: empty workspace shows "being prepared", never zeros; every tab is accessible', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signInAsNewOwner(page, 'e2e-analytics-empty')
  await page.goto('/dashboard')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Analytics' })
    .click()
  await expect(page).toHaveURL(/\/analytics$/)
  const tabs = page.getByRole('navigation', { name: /Analytics/ })
  for (const [, label] of [
    ['', 'Overview'],
    ['', 'Messaging'],
    ['', 'Campaigns'],
    ['', 'Inbox'],
    ['', 'Automations'],
    ['', 'Usage'],
  ])
    await expect(tabs.getByRole('link', { name: label, exact: true })).toBeVisible()
  for (const [path, heading] of VIEWS) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(page.getByText('Analytics are being prepared')).toBeVisible()
    await noViolations(page)
  }
})

test('Analytics: activity appears after processing, with chart, table alternative and range', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const owner = await signInAsNewOwner(page, 'e2e-analytics-data')
  await customerWritesIn(page, owner, 'Hello from analytics')
  await page.goto('/analytics/messaging')
  // The projection settles (~20 s) and the rollup runs every minute.
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('1 received from customers')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 150_000, intervals: [5_000] })
  // No outbound messages: rates are "—" with an explanation, never 0 %.
  await expect(page.getByText('No sent messages delivered in this period')).toBeVisible()
  await expect(page.getByRole('img', { name: /Messages per day by status/ })).toBeVisible()
  await page.getByRole('button', { name: 'Show as table' }).click()
  await expect(page.getByRole('table', { name: 'Messages per day by status' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Date range' }).click()
  await page.getByRole('option', { name: 'Last 7 days' }).click()
  await expect(page.getByText(/compared with the previous period/)).toBeVisible()
  await noViolations(page)

  await page.goto('/analytics/inbox')
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox analytics' })).toBeVisible()
  await expect(page.getByText('No teammate replies in this period')).toBeVisible()
  await noViolations(page)

  // Dashboard: the Messages metric comes from analytics.
  await page.goto('/dashboard')
  await expect(page.getByText('Sent · 7 days')).toBeVisible()
  await expect(page.getByText('Delivery · 7 days')).toBeVisible()
})
