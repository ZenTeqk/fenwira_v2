import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * ADR-0027 operator console → WhatsApp (UI only; the API is covered end to end by
 * apps/worker/test/managed-connection.int.test.ts). The platform API is mocked so the browser
 * flow — connect form, masked display, verify checks, secret fields cleared — is deterministic.
 */
const id = '019ceaaa-2222-7000-8000-000000000001'
const phoneId = '019ceaaa-2222-7000-8000-000000000003'
const TOKEN = 'EAAG-system-user-token-for-e2e-0001'
const SECRET = 'e2eappsecret0000000000000000beef'
const workspace = {
  id,
  name: 'Managed fixture',
  slug: 'managed-fixture',
  createdAt: '2026-10-01T00:00:00.000Z',
  billingMode: 'PREPAID',
}
const detail = {
  snapshot: { workspace, subscription: null, wallet: null, overrides: [] },
  version: 'a'.repeat(64),
  subscriptionsEnforced: false,
  plans: [],
  entitlements: [],
  credits: [],
  operations: [],
  ledger: [],
  reconciliation: { balanceMatches: true, reservationsMatch: true },
}
const connection = {
  id: phoneId,
  phoneNumberId: '109876543210',
  displayPhoneNumber: '+91 98765 43210',
  verifiedName: 'Acme Foods',
  label: null,
  waba: { id: '201234567890', name: 'Acme WABA' },
  connectionMode: 'MANAGED',
  status: 'CONNECTED',
  qualityRating: 'GREEN',
  messagingLimitTier: 'TIER_1K',
  throughputMps: 80,
  isDefault: true,
  webhookStatus: 'ACTIVE',
  credential: {
    status: 'VALID',
    tokenType: 'SYSTEM_USER',
    maskedToken: 'EAAG…0001',
    expiresAt: null,
    verifiedAt: null,
    verifyOk: null,
    verifyErrorCode: null,
  },
  steps: [],
  lastSyncedAt: '2026-10-22T10:00:00.000Z',
  connectedAt: '2026-10-22T10:00:00.000Z',
  createdAt: '2026-10-22T10:00:00.000Z',
  metaAppId: '111222333',
  businessId: null,
  appSecret: { maskedSecret: '••••beef', rotatedAt: null },
  templatesSyncedAt: null,
}

async function mock(page: Page, posted: unknown[]) {
  let connected = false
  await page.route('**/api/v1/platform/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1/platform', '')
    let data: unknown = null
    if (path === '/auth/me')
      data = {
        operatorId: id,
        permissions: ['commercial.read', 'whatsapp.read', 'whatsapp.manage'],
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        csrfToken: 'platform-csrf',
      }
    else if (path === `/workspaces/${id}`) data = detail
    else if (path === `/workspaces/${id}/whatsapp/connections` && req.method() === 'GET')
      data = connected ? [connection] : []
    else if (path === `/workspaces/${id}/whatsapp/connections` && req.method() === 'POST') {
      expect(req.headers()['x-csrf-token']).toBe('platform-csrf')
      posted.push(req.postDataJSON())
      connected = true
      return route.fulfill({ status: 201, json: { data: connection } })
    } else if (path.endsWith('/verify'))
      data = {
        ok: false,
        verifiedAt: '2026-10-22T11:00:00.000Z',
        checks: {
          token: { ok: true },
          phoneNumber: { ok: true },
          waba: {
            ok: false,
            error: { code: 'META_PERMISSION_DENIED', message: 'Permission denied' },
          },
        },
      }
    await route.fulfill({ json: { data } })
  })
}

async function axe(page: Page) {
  await page.waitForLoadState('networkidle')
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  )
}

test('operator connects a number; secrets are sent once and only shown masked', async ({
  page,
}) => {
  const posted: unknown[] = []
  await mock(page, posted)
  await page.goto(`/platform/workspaces/${id}`)
  await expect(page.getByRole('heading', { name: 'WhatsApp connection' })).toBeVisible()
  await expect(page.getByText('No WhatsApp number connected')).toBeVisible()

  await page.getByRole('button', { name: 'Connect WhatsApp number' }).click()
  const drawer = page.getByRole('dialog', { name: 'Connect WhatsApp number' })
  await drawer.getByLabel('WABA ID').fill('201234567890')
  await drawer.getByLabel('Phone number ID').fill('109876543210')
  await drawer.getByLabel('Display phone number').fill('+91 98765 43210')
  await drawer.getByLabel('System-user access token').fill(TOKEN)
  await expect(drawer.getByLabel('System-user access token')).toHaveAttribute('type', 'password')
  await drawer.getByLabel('App secret').fill(SECRET)
  await drawer.getByLabel('Meta app ID').fill('111222333')
  await axe(page)
  await drawer.getByRole('button', { name: 'Connect and verify' }).click()
  await expect(drawer).toHaveCount(0)

  expect(posted).toEqual([
    {
      wabaId: '201234567890',
      phoneNumberId: '109876543210',
      displayPhoneNumber: '+91 98765 43210',
      accessToken: TOKEN,
      appSecret: SECRET,
      appId: '111222333',
    },
  ])
  const card = page.getByRole('region', { name: 'WhatsApp number +91 98765 43210' })
  await expect(card.getByText('EAAG…0001')).toBeVisible()
  await expect(card.getByText('••••beef')).toBeVisible()
  expect(await page.content()).not.toContain(TOKEN)
  expect(await page.content()).not.toContain(SECRET)

  // Reopening the form starts empty: secrets aren't kept in component state.
  await page.getByRole('button', { name: 'Connect WhatsApp number' }).click()
  await expect(page.getByRole('dialog').getByLabel('System-user access token')).toHaveValue('')
  await page.keyboard.press('Escape')

  await card.getByRole('button', { name: 'Verify connection' }).click()
  const checks = card.getByRole('list', { name: 'Verification checks' })
  await expect(checks.getByText('META_PERMISSION_DENIED: Permission denied')).toBeVisible()
  // Sonner fades stacked toasts; axe reads that as low contrast. Let them expire, then audit.
  await expect(page.getByText('Meta rejected at least one check')).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await axe(page)
})
