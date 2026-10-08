import AxeBuilder from '@axe-core/playwright'
import { type ApiKey, type WebhookEndpoint, type WhatsAppConnection } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
test.beforeEach(() => resetRateLimits())

// Browser-only state fixtures. No connector, key, endpoint or delivery is persisted here.
test('Integrations overview: responsive summaries, sync, redaction, suspension and retry', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await signInAsNewOwner(page, 'integration-visual')
  const now = new Date().toISOString()
  const connection: WhatsAppConnection = {
    id: crypto.randomUUID(),
    phoneNumberId: '123456789012345',
    displayPhoneNumber: '+91 90000 01234',
    verifiedName: 'Textile sample business',
    label: 'Textile enquiries',
    waba: { id: '123456789012346', name: 'Textile sample business' },
    status: 'CONNECTED',
    qualityRating: 'GREEN',
    messagingLimitTier: 'TIER_1K',
    throughputMps: 80,
    isDefault: true,
    webhookStatus: 'ACTIVE',
    credential: { status: 'VALID', tokenType: 'DEV', maskedToken: 'mock…1234', expiresAt: null },
    steps: [],
    lastSyncedAt: now,
    connectedAt: now,
    createdAt: now,
  }
  const key: ApiKey = {
    id: crypto.randomUUID(),
    name: 'Textile catalog',
    prefix: 'demo1234',
    scopes: ['contacts.read'],
    createdBy: null,
    createdByName: null,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
  }
  const endpoint: WebhookEndpoint = {
    id: crypto.randomUUID(),
    name: 'Textile order updates',
    url: 'https://example.com/textiles/events?token=private-query-marker',
    events: ['contact.created', 'campaign.completed'],
    status: 'ACTIVE',
    failureCount: 0,
    createdBy: null,
    createdByName: null,
    createdAt: now,
    updatedAt: now,
  }
  let entitled = true
  let syncFailure = false
  let readFailure = false
  await page.route('**/api/v1/whatsapp/connections', (route) =>
    readFailure
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        })
      : route.fulfill({ json: { data: [connection] } }),
  )
  await page.route('**/api/v1/api-keys', (route) =>
    route.fulfill({
      json: {
        data: [key, { ...key, id: crypto.randomUUID(), revokedAt: now }],
        meta: { entitled },
      },
    }),
  )
  await page.route('**/api/v1/webhook-endpoints', (route) =>
    route.fulfill({
      json: {
        data: [
          endpoint,
          {
            ...endpoint,
            id: crypto.randomUUID(),
            name: 'Paused catalog updates',
            status: 'DISABLED',
            failureCount: 3,
          },
        ],
        meta: { entitled },
      },
    }),
  )
  await page.route(`**/api/v1/whatsapp/connections/${connection.id}/sync`, (route) =>
    syncFailure
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Fixture sync failed' } },
        })
      : route.fulfill({ json: { data: connection } }),
  )
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/integrations')
    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Manage Textile order updates', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('private-query-marker')).toHaveCount(0)
    await expect(page.getByText('mock…1234')).toHaveCount(0)
    await expect(page.getByText(/Shopify|Zoho CRM|ERPNext|Slack|Microsoft Teams/)).toHaveCount(0)
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`overview-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Sync now', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Synced with Meta', { exact: true })).toBeVisible()
  syncFailure = true
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.getByText('Fixture sync failed', { exact: true })).toBeVisible()
  entitled = false
  await page.reload()
  await expect(
    page.getByText('API access is suspended by your plan', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Webhook delivery is suspended by your plan', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Manage Textile order updates', exact: true }),
  ).toBeVisible()
  readFailure = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({
    timeout: 20000,
  })
  readFailure = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('Textile enquiries', { exact: true })).toBeVisible()
})

test('Integrations overview: empty and permission-filtered reads', async ({ page }) => {
  await signInAsNewOwner(page, 'integration-read')
  await page.goto('/integrations')
  await expect(page.getByText('No WhatsApp number connected', { exact: true })).toBeVisible()
  await expect(page.getByText('No webhook endpoints yet', { exact: true })).toBeVisible()
  let canRead = true
  const forbiddenReads: string[] = []
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const m of body.data.memberships)
      m.permissions = m.permissions.filter(
        (p: string) =>
          p !== 'integrations.manage' &&
          p !== 'whatsapp.manage' &&
          (canRead || p !== 'whatsapp.read'),
      )
    await route.fulfill({ response, json: body })
  })
  page.on('request', (request) => {
    if (/\/(api-keys|webhook-endpoints)(\/|$)/.test(new URL(request.url()).pathname))
      forbiddenReads.push(request.url())
  })
  await page.reload()
  await expect(page.getByText('No WhatsApp number connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Build with Fenwira', exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toHaveCount(0)
  expect(forbiddenReads).toEqual([])
  canRead = false
  await page.reload()
  await expect(page.getByText("You don't have access", { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage API keys →', exact: true })).toHaveCount(0)
  expect(forbiddenReads).toEqual([])
})
