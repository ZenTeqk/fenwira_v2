import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Operator console: workspaces list (search, filters, columns), Billing operations (cards, one
 * table per job with its next step, charts, empty states) and the Create invoice flow (preview →
 * create → payment link and copyable message). The platform API is mocked.
 */
const A = '019ceaaa-3333-7000-8000-000000000001'
const B = '019ceaaa-3333-7000-8000-000000000002'
const I = '019ceaaa-3333-7000-8000-000000000003'
const INV = '019ceaaa-3333-7000-8000-000000000004'
const PROOF = '019ceaaa-3333-7000-8000-000000000005'
const OLD = '019ceaaa-3333-7000-8000-000000000006'
const reminded: string[] = [],
  restoredWith: unknown[] = []
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
const row = (over: Record<string, unknown>) => ({
  slug: 'x',
  createdAt: '2026-10-01T00:00:00.000Z',
  internal: false,
  ownerEmail: null,
  plan: null,
  status: 'TRIALING',
  trialEndsAt: soon,
  currentPeriodEnd: null,
  nextDueAt: null,
  openInvoices: 0,
  openTotalMinor: '0',
  whatsapp: 'NONE',
  lastMessageAt: null,
  ...over,
})
const list = [
  row({
    id: A,
    name: 'Acme Sarees',
    slug: 'acme',
    ownerEmail: 'owner@acme.test',
    whatsapp: 'HEALTHY',
  }),
  row({
    id: B,
    name: 'Bharat Foods',
    slug: 'bharat',
    ownerEmail: 'ops@bharat.test',
    plan: { key: 'GROWTH', name: 'Growth' },
    status: 'PAST_DUE',
    trialEndsAt: null,
    nextDueAt: past,
    openInvoices: 1,
    openTotalMinor: '176882',
    whatsapp: 'ATTENTION',
    lastMessageAt: past,
  }),
  row({ id: I, name: 'Zenteqk Internal', slug: 'internal', internal: true, status: 'TRIALING' }),
]

async function mock(
  page: Page,
  posted: unknown[],
  opts: { lapsed?: boolean; reauth?: unknown[] } = {},
) {
  let fresh = !opts.lapsed,
    invoiced = false,
    restored = false
  await page.route('**/api/v1/platform/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1/platform', '')
    let data: unknown = null
    if (path === '/auth/me')
      data = {
        operatorId: I,
        permissions: [
          'commercial.read',
          'financial.read',
          'payments.read',
          'payments.manage',
          'workspaces.manage',
        ],
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        ...(fresh ? { mfaFreshUntil: new Date(Date.now() + 300000).toISOString() } : {}),
        csrfToken: 'platform-csrf',
        managedLaunch: true,
      }
    else if (path === `/workspaces/${B}/invoices/remind`) {
      reminded.push(B)
      data = { sent: 1, alreadyToday: 0 }
    } else if (path === '/deleted-workspaces')
      data = restored
        ? []
        : [
            {
              id: OLD,
              name: 'Old Trial Shop',
              slug: 'old-trial',
              deletedAt: past,
              ownerEmail: 'old@shop.test',
            },
          ]
    else if (path === `/workspaces/${OLD}/restore`) {
      restoredWith.push(req.postDataJSON())
      restored = true
      return route.fulfill({ status: 204 })
    } else if (path === '/auth/reauth') {
      opts.reauth?.push(req.postDataJSON())
      fresh = true
      return route.fulfill({ status: 204 })
    } else if (path === '/workspace-list')
      data = invoiced
        ? list.map((w) =>
            w.id === A ? { ...w, openInvoices: 1, openTotalMinor: '176882', nextDueAt: soon } : w,
          )
        : list
    else if (path === '/plans')
      data = [
        { key: 'GROWTH', name: 'Growth', monthly: { currency: 'INR', amountMinor: 149900 } },
        { key: 'BUSINESS', name: 'Business', monthly: null },
      ]
    else if (path === '/overview')
      data = {
        statusCounts: { TRIALING: 2, PAST_DUE: 1 },
        newWorkspaces: [],
        mrr: [{ currency: 'INR', amountMinor: 149900, workspaces: 1 }],
        trialsEnding: [{ workspaceId: A, name: 'Acme Sarees', trialEndsAt: soon }],
        connections: [],
        messagesByDay: [],
        failedSends7d: 0,
        emailFailures7d: 0,
        accessRequests: { new7d: 0, unsent: 0 },
        revenueByMonth: [],
        pendingPayments: 1,
        overdueWorkspaces: 1,
        queueBacklog: { waiting: 0, delayed: 0, failed: 0 },
        attention: [],
      }
    else if (path === '/billing/dashboard')
      data = {
        pending: [
          {
            workspaceId: B,
            workspaceName: 'Bharat Foods',
            proofId: PROOF,
            invoiceId: INV,
            invoiceNumber: 'FW-INV-0007',
            kind: 'PLAN_RENEWAL',
            totalMinor: '176882',
            currency: 'INR',
            utr: '412345678901',
            hasFile: false,
            submittedAt: past,
          },
        ],
        overdue: [
          {
            workspaceId: B,
            workspaceName: 'Bharat Foods',
            subscriptionStatus: 'PAST_DUE',
            openInvoices: 1,
            openTotalMinor: '176882',
            oldestDueAt: past,
          },
        ],
        revenue: [{ month: '2026-10', currency: 'INR', totalMinor: '149900', payments: 1 }],
      }
    else if (path === `/workspaces/${A}/invoices` && req.method() === 'POST') {
      posted.push(req.postDataJSON())
      if (!fresh)
        return route.fulfill({
          status: 403,
          json: { error: { code: 'TOTP_REQUIRED', message: 'Your identity check has expired.' } },
        })
      invoiced = true
      return route.fulfill({
        status: 201,
        json: {
          data: {
            id: INV,
            tenantId: A,
            operatorId: I,
            operation: 'invoice_issue',
            amountMinor: '149900',
            currency: 'INR',
            reason: 'Plan renewal',
            reference: 'r',
            idempotencyKey: 'invoice:k',
            requestHash: 'a'.repeat(64),
            before: {},
            after: {},
            result: { invoiceId: INV, number: 'FW-INV-0008', totalMinor: '176882' },
            correlationId: null,
            createdAt: new Date().toISOString(),
          },
        },
      })
    }
    await route.fulfill({ json: { data } })
  })
}

async function axe(page: Page) {
  await page.waitForLoadState('networkidle')
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([])
}

test('workspaces list: search, filters, health columns, click opens the workspace', async ({
  page,
}) => {
  await mock(page, [])
  await page.goto('/platform/workspaces')
  const table = page.getByRole('region', { name: 'Workspaces' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByText('Needs attention')).toBeVisible()
  await expect(table.getByText('1 · INR 1,768.82')).toBeVisible()
  await page.getByLabel('Search workspaces').fill('ops@bharat')
  await expect(table.getByRole('row')).toHaveCount(2)
  await page.getByLabel('Search workspaces').fill('')
  await page.getByRole('combobox', { name: 'Type' }).click()
  await page.getByRole('option', { name: 'Internal only' }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByText('Business (internal)')).toBeVisible()
  await axe(page)
  await table.getByRole('cell', { name: 'Business (internal)' }).click()
  await expect(page).toHaveURL(new RegExp(`/platform/workspaces/${I}$`))
})

test('billing operations: cards, actions and the create-invoice flow with payment link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const posted: unknown[] = []
  await mock(page, posted)
  await page.goto('/platform/billing-operations')
  await expect(page.getByRole('heading', { level: 1, name: 'Billing operations' })).toBeVisible()
  for (const label of [
    'MRR',
    'Pending payments',
    'Overdue',
    'Trials ending in 7 days',
    'Unpaid invoices',
  ])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve FW-INV-0007' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy reminder for Bharat Foods' }).first().click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('overdue since')
  const overdueTable = page.getByRole('region', { name: 'Overdue workspaces', exact: true })
  await expect(overdueTable.getByText('Never')).toBeVisible()
  await overdueTable.getByRole('button', { name: 'Send reminder to Bharat Foods' }).click()
  await expect(page.getByText('Reminder emailed to Bharat Foods for 1 invoice.')).toBeVisible()
  expect(reminded).toEqual([B])
  await expect(page.getByRole('heading', { name: 'Revenue by month' })).toBeVisible()
  await axe(page)

  await page.getByRole('button', { name: 'Create invoice for Acme Sarees' }).click()
  const drawer = page.getByRole('dialog', { name: 'Create invoice' })
  await drawer.getByRole('combobox', { name: 'Plan' }).click()
  await page.getByRole('option', { name: /Growth/ }).click()
  await drawer.getByRole('button', { name: 'Preview invoice' }).click()
  const preview = page.getByRole('dialog', { name: 'Check and create' })
  await expect(preview.getByText('Acme Sarees')).toBeVisible()
  await expect(preview.getByText('₹1,499.00')).toBeVisible()
  await preview.getByRole('button', { name: 'Create invoice' }).click()
  const done = page.getByRole('dialog', { name: 'Invoice created' })
  await expect(done.getByText('FW-INV-0008')).toBeVisible()
  await expect(done.getByLabel('Payment link')).toHaveValue(
    new RegExp(`/billing/invoices\\?invoice=${INV}$`),
  )
  await done.getByRole('button', { name: 'Copy message for customer' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('FW-INV-0008')
  expect(posted).toEqual([
    expect.objectContaining({ kind: 'PLAN_RENEWAL', planKey: 'GROWTH', amountMinor: 149900 }),
  ])
})

test('empty billing operations explain each table', async ({ page }) => {
  await mock(page, [])
  await page.route('**/api/v1/platform/billing/dashboard', (r) =>
    r.fulfill({ json: { data: { pending: [], overdue: [], revenue: [] } } }),
  )
  await page.route('**/api/v1/platform/workspace-list', (r) => r.fulfill({ json: { data: [] } }))
  await page.goto('/platform/billing-operations')
  await expect(page.getByText(/No payments to verify\. When a customer pays/)).toBeVisible()
  await expect(page.getByText(/No overdue workspaces\. A workspace appears here/)).toBeVisible()
  await expect(page.getByText(/No unpaid invoices\. Every open payment request/)).toBeVisible()
  await expect(page.getByText(/No payments approved yet/)).toBeVisible()
})

test('operator verifies identity inline, creates an invoice and sees it on Billing operations', async ({
  page,
}) => {
  const posted: unknown[] = [],
    reauth: unknown[] = []
  await mock(page, posted, { lapsed: true, reauth })
  await page.goto('/platform/billing-operations')
  await expect(page.getByText('Identity not verified')).toBeVisible()
  const unpaid = page.getByRole('region', { name: 'Unpaid invoices', exact: true })
  await expect(unpaid.getByRole('link', { name: 'Acme Sarees' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Create invoice' })
  await drawer.getByRole('combobox', { name: 'Workspace' }).click()
  await page.getByRole('option', { name: 'Acme Sarees' }).click()
  await expect(page.getByRole('option', { name: 'Zenteqk Internal' })).toHaveCount(0)
  await drawer.getByRole('combobox', { name: 'Plan' }).click()
  await page.getByRole('option', { name: /Growth/ }).click()
  await drawer.getByRole('button', { name: 'Preview invoice' }).click()
  await page
    .getByRole('dialog', { name: 'Check and create' })
    .getByRole('button', { name: 'Create invoice' })
    .click()

  const verify = page.getByRole('dialog', { name: 'Verify your identity' })
  await verify.getByLabel('Operator password').fill('Operator-Pw-e2e-2')
  await verify.getByLabel('Authenticator code').fill('654321')
  await verify.getByRole('button', { name: 'Verify and continue' }).click()

  const done = page.getByRole('dialog', { name: 'Invoice created' })
  await expect(done.getByText('FW-INV-0008')).toBeVisible()
  expect(reauth).toEqual([{ password: 'Operator-Pw-e2e-2', code: '654321' }])
  // The lapsed attempt and one automatic retry, both with the same idempotency key.
  expect(posted).toHaveLength(2)
  expect((posted[0] as { idempotencyKey: string }).idempotencyKey).toBe(
    (posted[1] as { idempotencyKey: string }).idempotencyKey,
  )
  await page.keyboard.press('Escape')
  await expect(unpaid.getByRole('link', { name: 'Acme Sarees' })).toBeVisible()
  await expect(unpaid.getByRole('row', { name: /Acme Sarees/ })).toContainText('1 · INR 1,768.82')
  await expect(page.getByText(/Verified for 5 minutes/)).toBeVisible()
  expect(await page.content()).not.toContain('Operator-Pw-e2e-2')
})

test('deleted workspaces can be restored with a reason', async ({ page }) => {
  await mock(page, [])
  await page.goto('/platform/workspaces')
  await page.getByText('Deleted workspaces (1)').click()
  await page.getByRole('button', { name: 'Restore Old Trial Shop' }).click()
  const drawer = page.getByRole('dialog', { name: 'Restore Old Trial Shop?' })
  await drawer.getByLabel('Reason').fill('Deleted by mistake')
  await drawer.getByRole('button', { name: 'Restore workspace' }).click()
  await expect(page.getByText('Old Trial Shop restored')).toBeVisible()
  await expect(page.getByText('Deleted workspaces (0)')).toBeVisible()
  expect(restoredWith).toEqual([{ reason: 'Deleted by mistake' }])
})
