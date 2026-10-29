import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { replyPreset, type FlowVersion } from '@fenwira/contracts'
import { mkdirSync } from 'node:fs'
import {
  API,
  ownerHeaders,
  refreshCsrf,
  resetRateLimits,
  signInAsNewOwner,
  type Owner,
} from './support'
async function seed(page: Page, owner: Owner, name: string, preset: 'keyword' | 'product-enquiry') {
  await refreshCsrf(page, owner)
  const r = await page.request.post(`${API}/flows`, {
    headers: ownerHeaders(owner),
    data: { name, managedBy: 'REPLY_STUDIO' },
  })
  expect(r.status()).toBe(201)
  const id = (await r.json()).data.id as string
  const version = (
    await (
      await page.request.get(`${API}/flows/${id}/draft`, { headers: ownerHeaders(owner) })
    ).json()
  ).data as FlowVersion
  expect(
    (
      await page.request.put(`${API}/flows/${id}/draft`, {
        headers: { ...ownerHeaders(owner), 'If-Match': version.etag },
        data: { graph: replyPreset(preset) },
      })
    ).status(),
  ).toBe(200)
  return id
}
async function quality(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([])
    if (process.env.REPLY_EXPERIENCE_SCREENSHOTS) {
      mkdirSync(process.env.REPLY_EXPERIENCE_SCREENSHOTS, { recursive: true })
      await page.screenshot({
        path: `${process.env.REPLY_EXPERIENCE_SCREENSHOTS}/${name}-${width}.png`,
        fullPage: true,
      })
    }
  }
}
test.beforeEach(() => resetRateLimits())
test('compact overview and empty, populated and filtered states preserve managed drafts', async ({
  page,
}) => {
  test.setTimeout(180000)
  const owner = await signInAsNewOwner(page, 'reply-experience')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations')
  await expect(page).toHaveURL(/\/automations\/workflows$/)
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
  await quality(page, 'overview')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/reply-studio')
  await expect(page).toHaveURL(/\/auto-replies$/)
  await expect(page.getByRole('heading', { name: 'Create your first auto reply' })).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create auto reply', exact: true })).toBeVisible()
  for (const card of await page
    .getByRole('region', { name: 'Starter flows' })
    .getByRole('article')
    .all())
    await expect(card).toBeInViewport({ ratio: 1 })
  await quality(page, 'empty')
  await page.getByRole('link', { name: 'Bot Flows', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your first bot flow' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create bot flow', exact: true })).toBeVisible()
  await seed(page, owner, 'Price reply draft', 'keyword')
  await seed(page, owner, 'Enquiry bot draft', 'product-enquiry')
  await page.goto('/automations/reply-studio/auto-replies')
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Enquiry bot draft', exact: true })).toHaveCount(0)
  const starters = page.getByRole('button', { name: 'Starter conversations', exact: true })
  await expect(starters).toHaveAttribute('aria-expanded', 'false')
  await starters.click()
  await page.reload()
  await expect(starters).toHaveAttribute('aria-expanded', 'true')
  await starters.click()
  await page.reload()
  await expect(starters).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('searchbox', { name: 'Search replies and flows' }).fill('unmatched')
  await expect(page.getByText('No results match your filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toBeVisible()
  await quality(page, 'populated')
  await page.getByRole('link', { name: 'Bot Flows', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Enquiry bot draft', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toHaveCount(0)
})
