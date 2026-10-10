import AxeBuilder from '@axe-core/playwright'
import {
  type InboxAnalytics,
  type MessagingAnalytics,
  type OverviewAnalytics,
} from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { API, ownerHeaders, resetRateLimits, signInAsNewOwner } from './support'

// Response fixtures exercise visual states only; no fabricated analytics are persisted.
test.beforeEach(() => resetRateLimits())

test('Analytics reconstruction: populated overview, responsive layout, range and retry', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const owner = await signInAsNewOwner(page, 'analytics-visual')
  const headers = ownerHeaders(owner)
  const read = async <T>(view: string) => {
    const response = await page.request.get(`${API}/analytics/${view}`, { headers })
    expect(response.status()).toBe(200)
    return (await response.json()) as T
  }
  const overview = await read<OverviewAnalytics>('overview')
  const messaging = await read<MessagingAnalytics>('messaging')
  const inbox = await read<InboxAnalytics>('inbox')
  for (const d of [overview, messaging, inbox]) d.meta.freshness.status = 'READY'
  overview.kpis.sent = { value: 28492, previous: 25000 }
  overview.kpis.deliveryRate = {
    value: 0.968,
    numerator: 27580,
    denominator: 28492,
    previous: 0.962,
  }
  overview.kpis.openConversations = 18
  overview.kpis.chargeMinor = { value: 174800, previous: 160000 }
  overview.currency = 'INR'
  overview.series = Array.from({ length: 12 }, (_, i) => ({
    day: `2026-09-${String(i + 10).padStart(2, '0')}`,
    values: { sent: 800 + i * 125, delivered: 760 + i * 120, read: 600 + i * 100, failed: i * 2 },
  }))
  overview.topCampaigns = [
    {
      campaignId: crypto.randomUUID(),
      name: 'Festive cotton collection',
      status: 'COMPLETED',
      startedDay: overview.meta.range.from,
      recipients: 2000,
      sent: 1986,
      delivered: 1920,
      read: 1620,
      failed: 14,
      skipped: 0,
      inProgress: 0,
      deliveryRate: 0.967,
      readRate: 0.844,
      failureRate: 0.007,
    },
  ]
  overview.topFlows = [
    { flowId: crypto.randomUUID(), name: 'Textile enquiry follow-up', executions: 184 },
  ]
  messaging.kpis.deliveryRate = overview.kpis.deliveryRate
  messaging.kpis.readRate = { value: 0.814, numerator: 22450, denominator: 27580, previous: 0.8 }
  messaging.kpis.inbound = { value: 6842, previous: 5800 }
  inbox.kpis.medianFirstResponseSeconds = 258
  inbox.kpis.firstResponses = 42
  inbox.kpis.openNow = 18
  inbox.kpis.awaitingFirstResponse = 4
  let failure = false
  let slowRange = false
  await page.route('**/api/v1/analytics/**', async (route) => {
    const url = new URL(route.request().url())
    const view = url.pathname.split('/').at(-1)
    if (view === 'overview' && slowRange && url.searchParams.get('days') === '7')
      await new Promise((resolve) => setTimeout(resolve, 1500))
    if (view === 'overview' && failure)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Analytics couldn’t load.' } },
      })
    const data = { overview, messaging, inbox }[view as 'overview' | 'messaging' | 'inbox']
    if (!data) return route.continue()
    await route.fulfill({ json: data })
  })
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/analytics')
    await expect(
      page.getByRole('heading', { name: 'Customer engagement', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('4m', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Usage', exact: true })).toBeVisible()
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // A wider panel must not scale up the graph or its SVG labels.
    const graph = page.getByRole('img', { name: /^Messages per day/ })
    await expect.poll(async () => (await graph.boundingBox())?.height).toBeCloseTo(160, 0)
    await page.screenshot({ path: info.outputPath(`overview-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Show as table' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'Messages per day', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Date range', exact: true }).click()
  slowRange = true
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await expect(page.getByLabel('Loading analytics')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Messaging activity', exact: true })).toBeVisible()
  slowRange = false
  await page.goto('/analytics/messaging')
  await expect(page.getByRole('combobox', { name: 'Date range', exact: true })).toContainText(
    'Last 7 days',
  )
  await page.goto('/analytics')
  failure = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({
    timeout: 20000,
  })
  failure = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Messaging activity', exact: true })).toBeVisible()
  await expect(page.getByText(/provider cost|margin/i)).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Date range', exact: true }).click()
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click()
  await expect(page.getByLabel('From', { exact: true })).toBeVisible()
  await expect(page.getByLabel('To', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  messaging.meta.freshness.status = 'NOT_STARTED'
  inbox.meta.freshness.status = 'NOT_STARTED'
  await page.reload()
  await expect(page.getByText('Analytics are being prepared.', { exact: true })).toHaveCount(2)
  overview.meta.freshness.status = 'DEGRADED'
  await page.reload()
  await expect(page.getByText('Analytics couldn’t be updated', { exact: true })).toBeVisible()
})

test('Analytics navigation preserves billing permission and read-denied states', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'analytics-permissions')
  let analyticsAllowed = true
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const m of body.data.memberships)
      m.permissions = m.permissions.filter(
        (p: string) => p !== 'billing.read' && (analyticsAllowed || p !== 'analytics.read'),
      )
    await route.fulfill({ response, json: body })
  })
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Analytics pages' })
      .getByRole('link', { name: 'Usage', exact: true }),
  ).toHaveCount(0)
  await page.goto('/analytics/usage')
  await expect(page.getByText(/You don.t have access/)).toBeVisible()
  analyticsAllowed = false
  await page.goto('/analytics')
  await expect(page.getByText(/You don.t have access/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Messaging activity', exact: true })).toHaveCount(
    0,
  )
  // Session-response narrowing verifies presentation, not a server grant. Server RBAC is unchanged.
  expect(
    (
      await page.request.get(`${API}/analytics/overview`, { headers: ownerHeaders(owner) })
    ).status(),
  ).toBe(200)
})
