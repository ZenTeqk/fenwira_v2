import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
const id = '019ceaaa-1111-7000-8000-000000000001'
const operatorId = '019ceaaa-1111-7000-8000-000000000002'
const permissions = [
  'commercial.read',
  'financial.read',
  'wallet.manage',
  'subscription.manage',
  'entitlements.manage',
  'audit.read',
]
const workspace = {
  id,
  name: 'Commercial fixture',
  slug: 'commercial-fixture',
  createdAt: '2026-10-01T00:00:00.000Z',
  billingMode: 'PREPAID',
}
const detail = {
  snapshot: {
    workspace,
    subscription: {
      id,
      status: 'ACTIVE',
      planId: id,
      trialEndsAt: null,
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      requestedPlanId: null,
    },
    wallet: {
      id,
      currency: 'INR',
      balanceMinor: '10000',
      availableMinor: '9000',
      reservedMinor: '1000',
      creditLimitMinor: '0',
    },
    overrides: [],
  },
  version: 'a'.repeat(64),
  subscriptionsEnforced: false,
  plans: [{ id, key: 'STARTER', name: 'Starter' }],
  entitlements: [
    { key: 'api_enabled', configured: false, enforced: true, usage: null, overLimit: false },
  ],
  credits: [{ fundType: 'PROMOTIONAL', grantedMinor: '5000' }],
  operations: [],
  ledger: [],
  reconciliation: { balanceMatches: true, reservationsMatch: true },
}
async function mock(page: Page, allowed = permissions) {
  await page.route('**/api/v1/platform/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/platform', '')
    expect(route.request().headers()['x-tenant-id']).toBeUndefined()
    let data: unknown
    if (path === '/auth/me')
      data = {
        operatorId,
        permissions: allowed,
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        csrfToken: 'platform-csrf',
      }
    else if (path === '/workspaces') data = [workspace]
    else if (path === `/workspaces/${id}`) data = detail
    else if (path.endsWith('/financial'))
      data = {
        currency: 'INR',
        customerChargeMinor: '2000',
        providerCostMinor: null,
        knownCostCustomerChargeMinor: '0',
        recordedContributionMinor: null,
        messages: 2,
        costKnownMessages: 0,
        costProvenance: 'Missing historical cost',
        taxMetadata: [],
      }
    else if (path.endsWith('-preview'))
      data = {
        version: detail.version,
        before: detail.snapshot,
        after: {
          ...detail.snapshot,
          wallet: { ...detail.snapshot.wallet, balanceMinor: '10100', availableMinor: '9100' },
        },
        result: {},
        entitlements: [],
      }
    else if (path.endsWith('-operations')) {
      const body = route.request().postDataJSON() as {
        idempotencyKey: string
        reason: string
        reference: string
      }
      data = {
        id,
        tenantId: id,
        operatorId,
        operation: 'paid_credit',
        amountMinor: '100',
        currency: 'INR',
        reason: body.reason,
        reference: body.reference,
        idempotencyKey: body.idempotencyKey,
        requestHash: 'a'.repeat(64),
        before: detail.snapshot,
        after: detail.snapshot,
        result: {},
        correlationId: null,
        createdAt: new Date().toISOString(),
      }
    } else if (path === '/audit')
      data = [
        {
          id,
          operatorId,
          workspaceId: id,
          action: 'commercial.paid_credit',
          outcome: 'SUCCESS',
          correlationId: null,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ]
    else data = null
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
test.setTimeout(60000)

test('platform login requires credentials and authenticator, with accessible forms', async ({
  page,
}) => {
  await page.goto('/platform/login')
  await expect(page.getByLabel('Password')).toBeVisible()
  await axe(page)
  await page.route('**/api/v1/platform/auth/login', (route) =>
    route.fulfill({ json: { data: { challengeToken: 'purpose-bound-platform-challenge' } } }),
  )
  await page.getByLabel('Email').fill('operator@fenwira.test')
  await page.getByLabel('Password').fill('fixture-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Authenticator code')).toBeVisible()
  await axe(page)
})
test('workspace commercial read, permissions and responsive accessibility', async ({ page }) => {
  await mock(page)
  await page.goto('/platform/workspaces')
  await page.getByRole('searchbox', { name: 'Find workspace' }).fill('Commercial')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('link', { name: 'Open Commercial fixture' }).click()
  await expect(page.getByRole('heading', { name: 'Internal financial visibility' })).toBeVisible()
  await expect(page.getByText('Missing historical cost', { exact: false })).toBeVisible()
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await axe(page)
  }
  await page.goto('/platform/audit')
  await page.getByRole('button', { name: 'Inspect commercial.paid_credit' }).click()
  await expect(page.getByRole('dialog', { name: 'Immutable audit event' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await axe(page)
})
test('read-only permission cannot see internal finances or commercial actions', async ({
  page,
}) => {
  let financialRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/financial')) financialRequests++
  })
  await mock(page, ['commercial.read'])
  await page.goto(`/platform/workspaces/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Commercial fixture' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Internal financial visibility' })).toHaveCount(0)
  expect(financialRequests).toBe(0)
  await expect(page.getByRole('link', { name: 'Audit', exact: true })).toHaveCount(0)
})
test('tenant session alone is redirected to platform login', async ({ page }) => {
  await page.route('**/api/v1/platform/auth/me', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHENTICATED', message: 'Privileged login required.' } },
    }),
  )
  await page.goto('/platform/workspaces')
  await expect(page).toHaveURL(/\/platform\/login(\?|$)/)
})

test('revoked privilege clears the commercial view after a denied request', async ({ page }) => {
  await mock(page)
  await page.goto(`/platform/workspaces/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Commercial fixture' })).toBeVisible()
  await page.route('**/api/v1/platform/audit', (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'FORBIDDEN', message: 'Platform authorization ended.' } },
    }),
  )
  await page.getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL(/\/platform\/login(\?|$)/)
  await expect(page.getByRole('heading', { level: 1, name: 'Commercial fixture' })).toHaveCount(0)
})

test('consequential funding needs preview and impact confirmation; retry retains key', async ({
  page,
}) => {
  const commands: unknown[] = []
  let first = true
  await mock(page)
  await page.route('**/api/v1/platform/workspaces/*/wallet-operations', async (route) => {
    const body = route.request().postDataJSON() as {
      reason: string
      reference: string
      idempotencyKey: string
    }
    commands.push(body)
    if (first) {
      first = false
      await route.abort('failed')
      return
    }
    await route.fulfill({
      json: {
        data: {
          id,
          tenantId: id,
          operatorId,
          operation: 'paid_credit',
          amountMinor: '100',
          currency: 'INR',
          reason: body.reason,
          reference: body.reference,
          idempotencyKey: body.idempotencyKey,
          requestHash: 'a'.repeat(64),
          before: detail.snapshot,
          after: detail.snapshot,
          result: {},
          correlationId: null,
          createdAt: new Date().toISOString(),
        },
      },
    })
  })
  await page.goto(`/platform/workspaces/${id}`)
  await page.getByRole('button', { name: 'Start billing adjustment' }).click()
  await page.getByLabel('Amount (INR)').fill('1.00')
  await page.getByLabel('Reason', { exact: false }).fill('Approved support credit')
  await page.getByLabel('Support / funding reference').fill('support-123')
  await expect(page.getByRole('button', { name: 'Review and confirm' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview impact' }).click()
  await expect(page.getByRole('heading', { name: 'Reviewed impact' })).toBeVisible()
  const drawerAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze()
  expect(drawerAxe.violations).toEqual([])
  await page.getByRole('button', { name: 'Review and confirm' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Confirm paid credit' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Enter')
  expect(commands).toHaveLength(0)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Review and confirm' }).click()
    await page.getByRole('button', { name: 'Record commercial operation' }).click()
    if (!attempt) await expect(page.getByText('Result uncertain:', { exact: false })).toBeVisible()
  }
  await expect(page.getByRole('dialog', { name: 'Commercial operation recorded' })).toBeVisible()
  expect(commands).toHaveLength(2)
  expect(commands[0]).toEqual(commands[1])
  await page.keyboard.press('Escape')
})
