import AxeBuilder from '@axe-core/playwright'
import { type Wallet, type WalletTransaction } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
test.beforeEach(() => resetRateLimits())

// Presentation fixtures only: no funding, subscription activation or rollout flag is written.
test('Billing wallet: compact reference composition, truthful financial states and responsive context', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await signInAsNewOwner(page, 'billing-visual')
  const now = new Date().toISOString()
  const planId = crypto.randomUUID()
  let failure = false
  const wallet: Wallet = {
    currency: 'INR',
    balanceMinor: 92900,
    creditLimitMinor: 0,
    reservedMinor: 8640,
    availableMinor: 84260,
    enforced: true,
    billingMode: 'PREPAID',
    state: 'NORMAL',
    lowBalanceThresholdMinor: 10000,
    spentThisMonthMinor: 12480,
    support: { email: null, url: 'https://example.com/billing-support' },
  }
  const transaction: WalletTransaction = {
    id: crypto.randomUUID(),
    type: 'CREDIT',
    fundType: 'PROMOTIONAL',
    amountMinor: 10000,
    balanceAfterMinor: 92900,
    currency: 'INR',
    reason: 'Textile launch promotion',
    referenceType: null,
    referenceId: null,
    expiresAt: null,
    createdAt: now,
  }
  await page.route('**/api/v1/billing/wallet', (route) =>
    failure
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        })
      : route.fulfill({
          json: {
            data: {
              ...wallet,
              providerCostMinor: 777777,
              privateProviderMarker: 'provider-secret-marker',
            },
          },
        }),
  )
  await page.route('**/api/v1/billing/wallet/transactions?*', (route) =>
    route.fulfill({
      json: {
        data: [transaction],
        page: { hasMore: false, nextCursor: null },
      },
    }),
  )
  await page.route('**/api/v1/billing/subscription', (route) =>
    route.fulfill({
      json: {
        data: {
          status: 'ACTIVE',
          plan: { id: planId, key: 'CONFIGURED', name: 'Textile Growth' },
          requestedPlan: null,
          requestedAt: null,
          interval: 'MONTH',
          trialEndsAt: null,
          trialDaysLeft: null,
          currentPeriodEnd: now,
          cancelAtPeriodEnd: false,
        },
      },
    }),
  )
  await page.route('**/api/v1/billing/plans', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: planId,
            key: 'CONFIGURED',
            name: 'Textile Growth',
            price: null,
            entitlements: {},
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/billing/entitlements', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            key: 'api_enabled',
            label: 'API access',
            kind: 'capability',
            enabled: false,
            limit: null,
            usage: null,
            overLimit: false,
          },
        ],
      },
    }),
  )
  await page.goto('/billing/wallet')
  await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible()
  await expect(page.getByText('₹842.60', { exact: true })).toBeVisible()
  await expect(page.getByText('Textile Growth', { exact: true })).toBeVisible()
  await expect(page.getByText('API access · not included')).toBeVisible()
  await expect(page.getByText('Contact us', { exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Wallet transactions' })).toContainText(
    'Promotional',
  )
  await expect(page.locator('main')).not.toContainText('provider-secret-marker')
  await expect(page.locator('main')).not.toContainText('₹7,777.77')
  await expect(page.getByRole('link', { name: 'Contact billing' }).first()).toHaveAttribute(
    'href',
    wallet.support.url!,
  )
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('heading', { name: 'Current plan' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('24px')
    const axe = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(axe.violations.map((v) => v.id)).toEqual([])
    await page.screenshot({ path: info.outputPath(`wallet-${width}.png`), fullPage: true })
  }
  wallet.state = 'LOW_BALANCE'
  wallet.availableMinor = 5000
  wallet.support = { email: null, url: null }
  await page.reload()
  await expect(page.getByText('Wallet balance is low', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contact billing' })).toHaveCount(0)
  wallet.state = 'INSUFFICIENT_FUNDS'
  wallet.availableMinor = 0
  await page.reload()
  await expect(page.getByText('Your wallet is out of credits')).toBeVisible()
  wallet.enforced = false
  wallet.state = 'NOT_ENFORCED'
  await page.reload()
  await expect(page.getByText('Messages aren’t billed in this workspace')).toBeVisible()
  failure = true
  await page.reload()
  await expect(page.getByText('Couldn’t load the wallet')).toBeVisible({ timeout: 20000 })
  failure = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('Couldn’t load the wallet')).toHaveCount(0)
  // Billing has one row of tabs (the shell's) and no Usage tab; usage lives under Analytics.
  await expect(page.getByRole('navigation', { name: 'Billing pages' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Usage', exact: true })).toHaveCount(0)
})

test('Billing wallet denies readers without billing permission and makes no financial requests', async ({
  page,
}) => {
  await signInAsNewOwner(page, 'billing-no-permission')
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const member of body.data.memberships)
      member.permissions = member.permissions.filter((p: string) => !p.startsWith('billing.'))
    await route.fulfill({ response, json: body })
  })
  const financialRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/v1\/billing\/(wallet|subscription|plans)/.test(request.url()))
      financialRequests.push(request.url())
  })
  await page.goto('/billing/wallet')
  await expect(page.getByText(/permission|access/i).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Available balance' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Current plan' })).toHaveCount(0)
  expect(financialRequests).toEqual([])
  const axe = await new AxeBuilder({ page }).withTags(tags).analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])
})
