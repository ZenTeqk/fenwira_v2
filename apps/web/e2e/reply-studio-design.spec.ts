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

async function quality(page: Page, name: string) {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width !== 1024) {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([])
      if (process.env.REPLY_DESIGN_SCREENSHOTS) {
        mkdirSync(process.env.REPLY_DESIGN_SCREENSHOTS, { recursive: true })
        await page.screenshot({
          path: `${process.env.REPLY_DESIGN_SCREENSHOTS}/${name}-${width}.png`,
          fullPage: true,
        })
      }
    }
  }
}
async function flow(page: Page, owner: Owner, name: string, populated: boolean, published = false) {
  const created = await page.request.post(`${API}/flows`, {
    headers: ownerHeaders(owner),
    data: { name, ...(populated ? { managedBy: 'REPLY_STUDIO' } : {}) },
  })
  expect(created.status(), await created.text()).toBe(201)
  const id = (await created.json()).data.id as string
  if (populated) {
    const version = (
      await (
        await page.request.get(`${API}/flows/${id}/draft`, { headers: ownerHeaders(owner) })
      ).json()
    ).data as FlowVersion
    const saved = await page.request.put(`${API}/flows/${id}/draft`, {
      headers: { ...ownerHeaders(owner), 'If-Match': version.etag },
      data: { graph: replyPreset('keyword') },
    })
    expect(saved.status()).toBe(200)
  }
  if (published)
    expect(
      (
        await page.request.post(`${API}/flows/${id}/publish`, {
          headers: { ...ownerHeaders(owner), 'Idempotency-Key': `design-${id}` },
          data: {},
        })
      ).status(),
    ).toBe(200)
  return id
}
test.beforeEach(() => resetRateLimits())
test('polished lists, existing actions, starter wizard and responsive accessibility', async ({
  page,
}) => {
  test.setTimeout(180000)
  let expired = false
  let sendingBlocked = false
  await page.route('**/api/v1/workspace/status', async (route) => {
    const response = await route.fetch(),
      json = await response.json()
    if (sendingBlocked) json.data.wallet.state = 'INSUFFICIENT_FUNDS'
    json.data.subscription = {
      ...json.data.subscription,
      status: expired ? 'EXPIRED' : 'TRIALING',
      trialDaysLeft: 0,
      trialEndsAt: new Date(Date.now() + (expired ? -3600000 : 3600000)).toISOString(),
      enforced: true,
      internal: false,
    }
    await route.fulfill({ response, json })
  })
  const owner = await signInAsNewOwner(page, 'reply-design')
  await page.goto('/automations/reply-studio')
  const banner = page.getByRole('status', { name: 'Trial reminder' })
  await expect(banner).toContainText('Trial ends today')
  await banner.getByRole('button', { name: 'Dismiss trial reminder until tomorrow' }).click()
  await page.reload()
  await expect(banner).toHaveCount(0)
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('fenwira.trial-reminder.'))
      .forEach((k) => localStorage.setItem(k, '2000-01-01')),
  )
  await page.reload()
  await expect(banner).toBeVisible()
  await expect(page.getByRole('link', { name: 'Use starter: Welcome reply' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create auto reply', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Bot Flows', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Create bot flow', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Use starter: FAQ menu' })).toBeVisible()
  await page.getByRole('link', { name: 'Use starter: Product Enquiry' }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Product Enquiry')
  await quality(page, 'create-flow')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Live preview' })
      .getByRole('region', { name: 'Message preview', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Live preview' })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await refreshCsrf(page, owner)
  const published = await flow(page, owner, 'Location reply', true, true)
  await flow(page, owner, 'Draft with a message', true)
  const empty = await flow(page, owner, 'Untitled automation', false)
  await page.goto('/automations')
  await expect(
    page
      .getByRole('navigation', { name: 'Automation tools' })
      .getByRole('link', { name: 'Auto Replies' }),
  ).toBeVisible()
  const row = page.getByRole('article', { name: 'Location reply', exact: true })
  await expect(row.getByText('Live', { exact: true })).toBeVisible()
  await row.getByRole('switch', { name: 'Pause Location reply' }).click()
  await expect(row.getByRole('switch', { name: 'Resume Location reply' })).not.toBeChecked()
  expect(
    (
      await (
        await page.request.get(`${API}/flows/${published}`, { headers: ownerHeaders(owner) })
      ).json()
    ).data.status,
  ).toBe('PAUSED')
  await row.getByRole('switch', { name: 'Resume Location reply' }).click()
  await expect(row.getByText('Live', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: /Drafts/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Clear empty drafts', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Clear 1 empty draft?' })
  await expect(confirm).toContainText('Untitled automation')
  await confirm.getByRole('button', { name: 'Clear empty drafts', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Untitled automation', exact: true })).toHaveCount(
    0,
  )
  expect(
    (await page.request.get(`${API}/flows/${empty}`, { headers: ownerHeaders(owner) })).status(),
  ).toBe(404)
  await expect(
    page.getByRole('article', { name: 'Draft with a message', exact: true }),
  ).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search automations' }).fill('no match')
  await expect(page.getByText('No results match your filters')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search automations' }).fill('')
  await expect(page.getByText('Empty drafts cleared.', { exact: true })).not.toBeVisible()
  await quality(page, 'automations')
  await page.goto('/automations/reply-studio')
  await expect(page.getByRole('article', { name: 'Location reply', exact: true })).toContainText(
    'You can find us at',
  )
  await quality(page, 'reply-studio')
  expired = true
  await page.reload()
  await expect(banner).toContainText('Trial has ended')
  await expect(banner.getByRole('button', { name: /Dismiss/ })).toHaveCount(0)
  expired = false
  sendingBlocked = true
  await page.reload()
  await expect(banner).toContainText('Trial ends today')
  await expect(banner.getByRole('button', { name: /Dismiss/ })).toHaveCount(0)
  sendingBlocked = false
  await page.clock.install()
  await page.reload()
  await expect(banner).toContainText('Trial ends today')
  await page.clock.fastForward(7200000)
  await expect(banner).toContainText('Trial has ended')
  await expect(banner.getByRole('button', { name: /Dismiss/ })).toHaveCount(0)
})
