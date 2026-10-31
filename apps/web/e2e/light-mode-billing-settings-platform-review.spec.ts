import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { PASSWORD, signInAsNewOwner, totp, applyReviewTheme, applyWebUpstream } from './support'
import { provisionOperator } from './support-platform'

// REVIEW_THEME=dark runs this review on the dark tokens.
test.beforeEach(async ({ context }) => {
  await applyWebUpstream(context)
  await applyReviewTheme(context)
})

// Light-mode review of Billing, Settings and the /platform console.
// - Billing: a real local owner; every /billing response is a contract-shaped fixture served in the
//   browser. Every billing write is refused by the route and asserted not to happen, so nothing is
//   funded, paid, submitted or approved. The UPI payee is fictional; the QR is generated with the
//   API's own `qrcode` settings (4-module quiet zone, 512 px).
// - Settings: the owner's real workspace; a long-named member is added in the browser only, and the
//   one save attempt is answered by a mocked validation error.
// - Platform: a real local operator fixture (revoked afterwards) viewing the owner's fresh
//   workspace. Cross-tenant lists (workspaces, overview, payments, audit, email, requests) are
//   fixtures, so no other local tenant appears. Drawers and confirmations are opened, never submitted.
// REVIEW_SHOTS_DIR saves review screenshots.

const shots = process.env.REVIEW_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForLoadState('networkidle')
  await settled(page)
  if (shots)
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage, animations: 'disabled' })
}
/** The same view on the dark tokens (data-theme, no switcher). */
const darkShot = async (page: Page, name: string, fullPage = false) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await shot(page, `${name}-dark`, fullPage)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await settled(page)
}
const axe = async (page: Page) => {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  await settled(page)
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([])
}
// REVIEW_BEFORE=1 (the unchanged baseline) records overflow instead of failing on it.
const overflowLog: string[] = []
/** Elements past the right edge that no horizontal scroll container clips (the real culprits). */
const overflowCulprits = (page: Page) =>
  page.evaluate(() => {
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX
        if (
          (x === 'auto' || x === 'scroll' || x === 'hidden' || x === 'clip') &&
          p.getBoundingClientRect().right <= innerWidth + 1
        )
          return true
      }
      return false
    }
    const out: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > innerWidth + 1 && !clipped(el))
        out.push(
          `${el.tagName.toLowerCase()}[${String(el.getAttribute('class') ?? '').slice(0, 80)}] right=${Math.round(r.right)}`,
        )
    }
    // Text can spill past a box that itself fits.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width && r.right > innerWidth + 1 && n.parentElement && !clipped(n.parentElement))
        out.push(
          `text "${(n.textContent ?? '').slice(0, 50)}" in ${n.parentElement.tagName.toLowerCase()}[${String(n.parentElement.getAttribute('class') ?? '').slice(0, 60)}] right=${Math.round(r.right)}`,
        )
    }
    return out.slice(0, 8)
  })
const noPageOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (process.env.REVIEW_BEFORE) {
    if (overflow > 0)
      overflowLog.push(
        `${page.url()} @${page.viewportSize()?.width}: ${overflow}px\n  ${(await overflowCulprits(page)).join('\n  ')}`,
      )
    return
  }
  expect(
    overflow,
    `${page.url()}\n${(await overflowCulprits(page)).join('\n')}`,
  ).toBeLessThanOrEqual(0)
}
test.afterAll(() => {
  if (shots && overflowLog.length)
    appendFileSync(join(shots, 'page-overflow.txt'), `${overflowLog.join('\n')}\n`)
})
const at = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 })
  await settled(page)
}

const qrcode = createRequire(resolve(__dirname, '../../api/package.json'))('qrcode') as {
  toDataURL: (text: string, options: object) => Promise<string>
}
const day = 86_400_000
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString()
const uuid = (n: number) => `019ceaaa-4444-7000-8000-${String(n).padStart(12, '0')}`
const PAYEE = { vpa: 'fenwira.billing@exampleupi', name: 'Fenwira Example Payee' }

// ─── Billing fixtures ──────────────────────────────────────────────────────────────────────────
const plans = [
  {
    id: uuid(1),
    key: 'STARTER',
    name: 'Starter',
    price: { amountMinor: 99_900, currency: 'INR', interval: 'MONTH' },
    entitlements: { max_users: 3, max_contacts: 1000, max_active_flows: 3, api_enabled: false },
  },
  {
    id: uuid(2),
    key: 'GROWTH',
    name: 'Growth',
    price: { amountMinor: 149_900, currency: 'INR', interval: 'MONTH' },
    entitlements: { max_users: 10, max_contacts: 10000, max_active_flows: 20, api_enabled: true },
  },
  {
    id: uuid(3),
    key: 'BUSINESS',
    name: 'Business',
    price: null,
    entitlements: {
      max_users: null,
      max_contacts: null,
      max_active_flows: null,
      api_enabled: true,
    },
  },
]
const subscription = {
  status: 'TRIALING',
  plan: null,
  requestedPlan: null,
  requestedAt: null,
  interval: 'MONTH',
  trialEndsAt: iso(5),
  trialDaysLeft: 5,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canUpgrade: true,
  paymentConfirmHours: 24,
  internal: false,
}
const ent = (key: string, label: string, over: Record<string, unknown>) => ({
  key,
  label,
  kind: 'limit',
  enabled: null,
  limit: null,
  usage: null,
  overLimit: false,
  ...over,
})
const entitlements = [
  ent('automation_enabled', 'Automations', { kind: 'capability', enabled: true }),
  ent('api_enabled', 'API access', { kind: 'capability', enabled: false }),
  ent('webhooks_enabled', 'Webhooks', { kind: 'capability', enabled: false }),
  ent('max_users', 'Team members', { limit: 3, usage: 3 }),
  ent('max_contacts', 'Contacts', { limit: 1000, usage: 1180, overLimit: true }),
  ent('max_active_flows', 'Active automations', { limit: 5, usage: 2 }),
  ent('analytics_retention', 'Analytics history (days)', { limit: 90, usage: null }),
]
const wallet = {
  currency: 'INR',
  balanceMinor: 1_234_567_890,
  creditLimitMinor: 0,
  reservedMinor: 8_640,
  availableMinor: 1_234_559_250,
  enforced: true,
  billingMode: 'PREPAID',
  state: 'NORMAL',
  lowBalanceThresholdMinor: 10_000,
  spentThisMonthMinor: 12_480,
  support: { email: 'billing@example.test', url: null },
}
const tx = (n: number, type: string, fundType: string, amountMinor: number, reason: string) => ({
  id: uuid(100 + n),
  type,
  fundType,
  amountMinor,
  balanceAfterMinor: 1_234_567_890 - n * 1_000,
  currency: 'INR',
  reason,
  referenceType: null,
  referenceId: null,
  expiresAt: null,
  createdAt: iso(-n),
})
const transactions = [
  tx(0, 'DEBIT', 'PAID', -86, 'Marketing template message'),
  tx(1, 'CREDIT', 'PAID', 1_234_500_000, 'Wallet top-up FW-INV-000124 (UPI)'),
  tx(2, 'CREDIT', 'PROMOTIONAL', 10_000, 'Launch promotion for handloom and silk saree retailers'),
  tx(3, 'ADJUSTMENT', 'PAID', -2_500, 'Correction for a duplicated test campaign charge'),
  tx(4, 'REFUND', 'PAID', 86, 'Refund for a message Meta did not deliver'),
]
const invoice = (over: Record<string, unknown>) => ({
  id: uuid(200),
  number: 'FW-INV-000123',
  kind: 'PLAN_RENEWAL',
  status: 'OPEN',
  displayStatus: 'DUE',
  currency: 'INR',
  subtotalMinor: 149_900,
  taxMinor: 26_982,
  totalMinor: 176_882,
  taxLines: [{ label: 'IGST 18%', rateBps: 1800, amountMinor: 26_982 }],
  description: 'Growth plan, 1 month from payment confirmation',
  plan: { key: 'GROWTH', name: 'Growth' },
  dueAt: iso(3),
  issuedAt: iso(-1),
  paidAt: null,
  voidReason: null,
  payee: PAYEE,
  gstin: null,
  receiptNumber: null,
  proofs: [],
  upi: null,
  ...over,
})
const proof = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  id: uuid(300 + n),
  utr: `41234567890${n}`,
  status,
  hasFile: false,
  submittedAt: iso(-n),
  reviewedAt: status === 'PENDING' ? null : iso(-n + 0.5),
  rejectionReason: null,
  receiptNumber: null,
  ...over,
})

async function billingFixtures(page: Page, managed: boolean) {
  const deepLink = `upi://pay?pa=${PAYEE.vpa}&pn=${encodeURIComponent(PAYEE.name)}&am=1768.82&cu=INR&tn=FW-INV-000123`
  const qrDataUrl = await qrcode.toDataURL(deepLink, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 512,
    color: { dark: '#000000', light: '#ffffff' },
  })
  const invoices = [
    invoice({
      proofs: [
        proof(2, 'REJECTED', { rejectionReason: 'The UTR did not match the amount received.' }),
      ],
      upi: { deepLink, qrDataUrl },
    }),
    invoice({
      id: uuid(201),
      number: 'FW-INV-000124',
      kind: 'WALLET_TOPUP',
      displayStatus: 'PAYMENT_SUBMITTED',
      subtotalMinor: 1_046_271_093,
      taxMinor: 188_328_797,
      totalMinor: 1_234_599_890,
      taxLines: [{ label: 'IGST 18%', rateBps: 1800, amountMinor: 188_328_797 }],
      description: 'WhatsApp wallet credits',
      plan: null,
      proofs: [proof(1, 'PENDING', { hasFile: true })],
      upi: { deepLink, qrDataUrl },
    }),
    invoice({
      id: uuid(202),
      number: 'FW-INV-000101',
      status: 'PAID',
      displayStatus: 'PAID',
      dueAt: iso(-30),
      issuedAt: iso(-33),
      paidAt: iso(-31),
      receiptNumber: 'FW-RCT-000088',
      proofs: [proof(31, 'APPROVED', { receiptNumber: 'FW-RCT-000088' })],
    }),
    invoice({
      id: uuid(203),
      number: 'FW-INV-000099',
      status: 'VOID',
      displayStatus: 'VOID',
      voidReason: 'Replaced by FW-INV-000101',
      dueAt: iso(-40),
      issuedAt: iso(-43),
    }),
  ]
  const writes: string[] = []
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.features = { ...body.data.features, managedLaunch: managed }
    await route.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/billing/**', async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1/billing', '')
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${path}`)
      return route.fulfill({ status: 418, json: { error: { code: 'X', message: 'Fixture' } } })
    }
    const json = (data: unknown, extra: object = {}) => route.fulfill({ json: { data, ...extra } })
    if (path === '/wallet') return json(wallet)
    if (path.startsWith('/wallet/transactions'))
      return json(transactions, { page: { hasMore: true, nextCursor: 'next' } })
    if (path === '/subscription') return json(subscription)
    if (path === '/plans') return json(plans)
    if (path === '/entitlements') return json(entitlements)
    if (path === '/invoices') return json(invoices.map(({ upi: _upi, ...rest }) => rest))
    const one = invoices.find((i) => path === `/invoices/${i.id}`)
    if (one) return json(one)
    return route.fallback()
  })
  return { writes, invoices }
}

test('billing: wallet, subscription and Managed Launch invoices with UPI', async ({ page }) => {
  test.setTimeout(240_000)
  await at(page, 1440)
  await signInAsNewOwner(page, 'lm-billing', 'Sri Lakshmi Handloom Silk Sarees Private Limited')
  const fixtures = await billingFixtures(page, false)

  // Wallet: normal, then the low / out-of-credit notices.
  await page.goto('/billing/wallet')
  await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible()
  await expect(page.getByText('Promotional').first()).toBeVisible()
  await shot(page, 'billing-wallet-1440', true)
  await darkShot(page, 'billing-wallet-1440', true)
  await axe(page)
  await page.getByRole('combobox', { name: 'Type' }).click()
  await shot(page, 'billing-wallet-type-filter-1440')
  await page.keyboard.press('Escape')
  for (const width of [1024, 768, 375]) {
    await at(page, width)
    await noPageOverflow(page)
    await shot(page, `billing-wallet-${width}`, true)
  }
  await at(page, 1440)
  Object.assign(wallet, { state: 'LOW_BALANCE', availableMinor: 5_000, balanceMinor: 13_640 })
  await page.reload()
  await expect(page.getByText('Wallet balance is low')).toBeVisible()
  await shot(page, 'billing-wallet-low-balance-1440')
  Object.assign(wallet, { state: 'INSUFFICIENT_FUNDS', availableMinor: 0, balanceMinor: 8_640 })
  await page.reload()
  await expect(page.getByText('Your wallet is out of credits')).toBeVisible()
  await shot(page, 'billing-wallet-insufficient-1440')
  await darkShot(page, 'billing-wallet-insufficient-1440')
  await axe(page)

  // Subscription: trial, limits (one over the limit), features and plans.
  await page.goto('/billing/subscription')
  await expect(page.getByRole('heading', { level: 1, name: 'Subscription' })).toBeVisible()
  await shot(page, 'billing-subscription-1440', true)
  await darkShot(page, 'billing-subscription-1440', true)
  await axe(page)
  await at(page, 375)
  await noPageOverflow(page)
  await shot(page, 'billing-subscription-375', true)
  await at(page, 1440)

  // Managed Launch: one Billing page with the open invoice, UPI QR, UTR form and history.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  const managed = await billingFixtures(page, true)
  await page.goto('/billing/invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
  const pay = page.locator('#pay-now')
  const qr = pay.getByRole('img', { name: /UPI QR code to pay ₹1,768.82 for FW-INV-000123/ })
  await expect(qr).toBeVisible()
  const box = (await qr.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(240)
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
  await shot(page, 'billing-invoices-managed-1440', true)
  await darkShot(page, 'billing-invoices-managed-1440', true)
  // The QR is the API's PNG unchanged: opaque white quiet zone, so it scans on either theme.
  const [qrWidth, qrHeight, ...corner] = await qr.evaluate(async (el: HTMLImageElement) => {
    await el.decode()
    const c = document.createElement('canvas')
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(el, 0, 0)
    return [el.naturalWidth, el.naturalHeight, ...ctx.getImageData(2, 2, 1, 1).data]
  })
  expect(qrWidth).toBe(qrHeight)
  expect(qrWidth).toBeGreaterThanOrEqual(500)
  expect(corner).toEqual([255, 255, 255, 255])
  await axe(page)
  // Client-side UTR validation: nothing is sent.
  await pay.getByLabel('UTR / UPI reference number').fill('12')
  await pay.getByRole('button', { name: 'Submit payment' }).click()
  await expect(pay.getByRole('alert')).toBeVisible()
  await pay.scrollIntoViewIfNeeded()
  await shot(page, 'billing-invoices-utr-validation-1440')
  await pay.getByLabel('UTR / UPI reference number').fill('')

  // Invoice drawers: payment submitted (verifying), paid with receipt, void.
  await page.getByRole('button', { name: 'FW-INV-000124' }).click()
  const drawer = page.getByRole('dialog', { name: /Invoice FW-INV-000124/ })
  await expect(drawer.getByText("We're verifying your payment")).toBeVisible()
  await expect(drawer.getByRole('img', { name: /UPI QR/ })).toHaveCount(0)
  await shot(page, 'billing-invoice-verifying-drawer-1440')
  await axe(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'FW-INV-000101' }).click()
  const paid = page.getByRole('dialog', { name: /Invoice FW-INV-000101/ })
  await expect(paid.getByRole('button', { name: 'Receipt' })).toBeVisible()
  await shot(page, 'billing-invoice-paid-drawer-1440')
  await darkShot(page, 'billing-invoice-paid-drawer-1440')
  await page.keyboard.press('Escape')

  for (const width of [768, 375]) {
    await at(page, width)
    await noPageOverflow(page)
    await expect(qr).toBeVisible()
    await shot(page, `billing-invoices-managed-${width}`, true)
  }
  await at(page, 375)
  await page.getByRole('button', { name: 'FW-INV-000124' }).click()
  await shot(page, 'billing-invoice-verifying-drawer-375')
  await page.keyboard.press('Escape')
  expect([...fixtures.writes, ...managed.writes]).toEqual([])
})

test('settings: workspace, team, roles, security, audit and WhatsApp', async ({ page }) => {
  test.setTimeout(180_000)
  await at(page, 1440)
  await signInAsNewOwner(page, 'lm-settings', 'Sri Lakshmi Handloom Silk Sarees Private Limited')
  await page.route('**/api/v1/team/members', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = await response.json()
    const owner = body.data[0]
    body.data.push(
      {
        ...owner,
        membershipId: uuid(400),
        userId: uuid(401),
        name: 'Venkata Subramanian Ramachandran Iyer Krishnamurthy',
        email: 'venkata.subramanian.ramachandran.iyer.krishnamurthy@example.test',
        role: 'ADMIN',
        twoFactorEnabled: false,
      },
      {
        ...owner,
        membershipId: uuid(402),
        userId: uuid(403),
        name: 'Meena Iyer',
        email: 'meena@example.test',
        role: 'AGENT',
        status: 'DEACTIVATED',
        twoFactorEnabled: true,
      },
    )
    await route.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/team/invitations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      json: {
        data: [
          {
            id: uuid(410),
            email: 'new.agent.for.the.chennai.showroom@example.test',
            role: 'AGENT',
            status: 'PENDING',
            invitedByName: 'lm-settings Owner',
            expiresAt: iso(6),
            createdAt: iso(-1),
          },
        ],
      },
    })
  })
  // The one save attempt gets a validation error; nothing is written.
  let patched = 0
  await page.route('**/api/v1/workspace', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    patched++
    await route.fulfill({
      status: 400,
      json: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Check the highlighted fields.',
          fieldErrors: [{ path: 'name', message: 'Enter a workspace name.' }],
        },
      },
    })
  })

  await page.goto('/settings/workspace')
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace' })).toBeVisible()
  await shot(page, 'settings-workspace-1440', true)
  await darkShot(page, 'settings-workspace-1440', true)
  await axe(page)
  await page.getByLabel('Workspace name').fill('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Enter a workspace name.')).toBeVisible()
  await shot(page, 'settings-workspace-validation-1440')
  expect(patched).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: 'Add reply' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot(page, 'settings-canned-reply-dialog-1440')
  await axe(page)
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: 'Transfer ownership' }).click()
  await shot(page, 'settings-transfer-dropdown-1440')
  await page.keyboard.press('Escape')
  await at(page, 375)
  await noPageOverflow(page)
  await shot(page, 'settings-workspace-375', true)
  await at(page, 1440)

  for (const [path, name, heading] of [
    ['/settings/team', 'team', 'Team'],
    ['/settings/roles', 'roles', 'Roles'],
    ['/settings/security', 'security', 'Security'],
    ['/settings/audit-logs', 'audit-logs', 'Audit log'],
    ['/settings/whatsapp', 'whatsapp', 'WhatsApp'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(heading) })).toBeVisible()
    await shot(page, `settings-${name}-1440`, true)
    if (name === 'team' || name === 'security' || name === 'roles')
      await darkShot(page, `settings-${name}-1440`, true)
    await axe(page)
    if (name === 'team' || name === 'security' || name === 'roles') {
      await at(page, 375)
      await noPageOverflow(page)
      await shot(page, `settings-${name}-375`, true)
      await at(page, 1440)
    }
  }
  // Destructive confirmation on Team, then cancelled.
  await page.goto('/settings/team')
  await page
    .getByRole('button', { name: /Deactivate|More actions|Actions/ })
    .first()
    .click()
    .catch(() => undefined)
  if (
    await page
      .getByRole('menuitem')
      .first()
      .isVisible()
      .catch(() => false)
  )
    await shot(page, 'settings-team-row-menu-1440')
  await page.keyboard.press('Escape')
})

// ─── Platform fixtures ─────────────────────────────────────────────────────────────────────────
const LONG = 'Sri Lakshmi Narasimha Handloom Silk Sarees & Textiles Private Limited'
const row = (over: Record<string, unknown>) => ({
  slug: 'x',
  createdAt: iso(-20),
  internal: false,
  ownerEmail: null,
  plan: null,
  status: 'TRIALING',
  trialEndsAt: iso(3),
  currentPeriodEnd: null,
  nextDueAt: null,
  openInvoices: 0,
  openTotalMinor: '0',
  whatsapp: 'NONE',
  lastMessageAt: null,
  ...over,
})

async function platformFixtures(page: Page, target: { id: string; name: string }) {
  const B = uuid(501)
  const list = [
    row({
      id: target.id,
      name: target.name,
      slug: 'sri-lakshmi',
      ownerEmail: 'owner@sri-lakshmi.example.test',
      whatsapp: 'HEALTHY',
      lastMessageAt: iso(-0.2),
    }),
    row({
      id: B,
      name: 'Bharat Foods',
      slug: 'bharat',
      ownerEmail: 'ops@bharat.example.test',
      plan: { key: 'GROWTH', name: 'Growth' },
      status: 'PAST_DUE',
      trialEndsAt: null,
      nextDueAt: iso(-5),
      openInvoices: 2,
      openTotalMinor: '1234599890',
      whatsapp: 'ATTENTION',
      lastMessageAt: iso(-2),
    }),
    row({ id: uuid(502), name: 'Zenteqk Internal', slug: 'internal', internal: true }),
    row({
      id: uuid(503),
      name: 'Coastal Spices',
      slug: 'coastal',
      plan: { key: 'STARTER', name: 'Starter' },
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: iso(20),
      whatsapp: 'HEALTHY',
    }),
  ]
  const pending = [
    {
      workspaceId: target.id,
      workspaceName: target.name,
      proofId: uuid(510),
      invoiceId: uuid(511),
      invoiceNumber: 'FW-INV-000124',
      kind: 'WALLET_TOPUP',
      totalMinor: '1234599890',
      currency: 'INR',
      utr: '412345678901',
      hasFile: true,
      submittedAt: iso(-0.3),
    },
    {
      workspaceId: B,
      workspaceName: 'Bharat Foods',
      proofId: uuid(512),
      invoiceId: uuid(513),
      invoiceNumber: 'FW-INV-000119',
      kind: 'PLAN_RENEWAL',
      totalMinor: '176882',
      currency: 'INR',
      utr: 'HDFC00012345678',
      hasFile: false,
      submittedAt: iso(-1.2),
    },
  ]
  const dashboard = {
    pending,
    overdue: [
      {
        workspaceId: B,
        workspaceName: 'Bharat Foods',
        subscriptionStatus: 'PAST_DUE',
        openInvoices: 2,
        openTotalMinor: '1234599890',
        oldestDueAt: iso(-5),
      },
    ],
    revenue: [
      { month: '2026-10', currency: 'INR', totalMinor: '449700', payments: 3 },
      { month: '2026-09', currency: 'INR', totalMinor: '299800', payments: 2 },
      { month: '2026-08', currency: 'INR', totalMinor: '149900', payments: 1 },
    ],
  }
  const invoices = [
    {
      id: uuid(511),
      workspaceId: target.id,
      number: 'FW-INV-000124',
      kind: 'WALLET_TOPUP',
      status: 'OPEN',
      displayStatus: 'PAYMENT_SUBMITTED',
      currency: 'INR',
      subtotalMinor: '1046271093',
      taxMinor: '188328797',
      totalMinor: '1234599890',
      description: 'WhatsApp wallet credits',
      plan: null,
      dueAt: iso(3),
      issuedAt: iso(-1),
      paidAt: null,
      voidReason: null,
      payee: PAYEE,
      gstin: null,
      receiptNumber: null,
      proofs: [],
      createdByType: 'OPERATOR',
    },
    {
      id: uuid(514),
      workspaceId: target.id,
      number: 'FW-INV-000123',
      kind: 'PLAN_RENEWAL',
      status: 'OPEN',
      displayStatus: 'DUE',
      currency: 'INR',
      subtotalMinor: '149900',
      taxMinor: '26982',
      totalMinor: '176882',
      description: 'Growth plan, 1 month from payment confirmation',
      plan: { key: 'GROWTH', name: 'Growth' },
      dueAt: iso(3),
      issuedAt: iso(-1),
      paidAt: null,
      voidReason: null,
      payee: PAYEE,
      gstin: null,
      receiptNumber: null,
      proofs: [],
      createdByType: 'SYSTEM',
    },
    {
      id: uuid(515),
      workspaceId: target.id,
      number: 'FW-INV-000101',
      kind: 'PLAN_RENEWAL',
      status: 'PAID',
      displayStatus: 'PAID',
      currency: 'INR',
      subtotalMinor: '149900',
      taxMinor: '26982',
      totalMinor: '176882',
      description: 'Growth plan, 1 month from payment confirmation',
      plan: { key: 'GROWTH', name: 'Growth' },
      dueAt: iso(-30),
      issuedAt: iso(-33),
      paidAt: iso(-31),
      voidReason: null,
      payee: PAYEE,
      gstin: null,
      receiptNumber: 'FW-RCT-000088',
      proofs: [],
      createdByType: 'SYSTEM',
    },
  ]
  const audit = [
    ['platform.login', 'SUCCESS', null],
    ['commercial.workspace_viewed', 'SUCCESS', target.id],
    ['platform.payment_proof_viewed', 'SUCCESS', target.id],
    ['platform.mfa', 'DENIED', null],
    ['platform.whatsapp_resubscribe', 'FAILED', B],
  ].map(([action, outcome, workspaceId], i) => ({
    id: uuid(520 + i),
    operatorId: uuid(530),
    workspaceId,
    action,
    outcome,
    correlationId: `corr-${i}-7f3a`,
    createdAt: iso(-i * 0.1),
    details: i === 2 ? { proofId: uuid(510), invoiceNumber: 'FW-INV-000124' } : null,
  }))
  const fixtures: Record<string, unknown> = {
    '/workspace-list': list,
    '/billing/dashboard': dashboard,
    '/deleted-workspaces': [
      {
        id: uuid(540),
        name: 'Old Trial Shop',
        slug: 'old-trial',
        deletedAt: iso(-5),
        ownerEmail: 'old@shop.example.test',
      },
    ],
    '/access-requests': [
      {
        id: uuid(541),
        name: 'Meena Iyer',
        company: 'Magnolia Handlooms',
        email: 'meena@magnolia.example.test',
        phone: '+919800000001',
        volume: '1k-10k',
        status: 'EMAILED',
        createdAt: iso(-2),
      },
      {
        id: uuid(542),
        name: 'Arjun Rao',
        company: LONG,
        email: 'arjun.rao@example.test',
        phone: '+919800000002',
        volume: '<1k',
        status: 'QUEUED',
        createdAt: iso(-0.5),
      },
    ],
    '/email-deliveries': [
      {
        id: uuid(550),
        kind: 'invoice_issued',
        status: 'SENT',
        recipientHint: 'o***@sri-lakshmi…',
        errorCode: null,
        createdAt: iso(-1),
      },
      {
        id: uuid(551),
        kind: 'payment_reminder',
        status: 'FAILED',
        recipientHint: 'o***@bharat…',
        errorCode: 'SMTP_TIMEOUT',
        createdAt: iso(-2),
      },
      {
        id: uuid(552),
        kind: 'receipt',
        status: 'SKIPPED_NO_SMTP',
        recipientHint: 'a***@coastal…',
        errorCode: null,
        createdAt: iso(-3),
      },
    ],
    '/audit': audit,
    '/ai/requests': [
      {
        id: uuid(560),
        status: 'REQUESTED',
        planId: null,
        planName: null,
        expectedConversations: 1200,
        useCase: 'Answer saree availability and delivery questions after showroom hours.',
        contactEmail: 'owner@sri-lakshmi.example.test',
        contactPhone: '+919800000003',
        decisionNote: null,
        decidedAt: null,
        createdAt: iso(-0.4),
        workspaceId: target.id,
        workspaceName: target.name,
        includedReplies: null,
      },
    ],
    '/overview': {
      statusCounts: { TRIALING: 2, ACTIVE: 1, PAST_DUE: 1 },
      newWorkspaces: [
        { month: '2026-08', count: 1 },
        { month: '2026-09', count: 2 },
        { month: '2026-10', count: 4 },
      ],
      mrr: [{ currency: 'INR', amountMinor: 249800, workspaces: 2 }],
      trialsEnding: [{ workspaceId: target.id, name: target.name, trialEndsAt: iso(3) }],
      connections: [],
      messagesByDay: Array.from({ length: 14 }, (_, i) => ({
        day: new Date(Date.now() - (13 - i) * day).toISOString().slice(0, 10),
        inbound: 40 + ((i * 7) % 15),
        outbound: 60 + ((i * 11) % 25),
      })),
      failedSends7d: 3,
      emailFailures7d: 1,
      accessRequests: { new7d: 2, unsent: 1 },
      revenueByMonth: dashboard.revenue.map((r) => ({ ...r, totalMinor: Number(r.totalMinor) })),
      pendingPayments: 2,
      overdueWorkspaces: 1,
      queueBacklog: { waiting: 0, delayed: 0, failed: 0 },
      attention: [],
    },
  }
  fixtures[`/workspaces/${target.id}/invoices`] = invoices
  await page.route('**/api/v1/platform/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1/platform', '')
    if (req.method() === 'GET' && path in fixtures)
      return route.fulfill({ json: { data: fixtures[path] } })
    return route.fallback()
  })
}

test('platform console: workspaces, payments, billing operations, workspace detail and audit', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const operator = await provisionOperator(page, 'lm-platform')
  const ownerContext = await browser.newContext()
  try {
    const owner = await signInAsNewOwner(await ownerContext.newPage(), 'lm-platform-owner', LONG)
    await at(page, 1440)
    await page.goto('/platform/login')
    await shot(page, 'platform-login-1440')
    await axe(page)
    await page.getByLabel('Email').fill(operator.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Authenticator code').fill(totp(operator.secret, 1))
    await page.getByRole('button', { name: 'Verify and enter platform' }).click()
    await expect(page).toHaveURL(/\/platform\/workspaces$/)
    await platformFixtures(page, { id: owner.tenantId, name: LONG })
    // Block every platform write except the read-only commercial preview.
    const writes: string[] = []
    await page.route('**/api/v1/platform/**', async (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      const allowed = /\/(auth\/(keepalive|reauth|logout)|[a-z]+-preview)$/.test(path)
      if (req.method() === 'GET' || allowed) return route.fallback()
      writes.push(`${req.method()} ${path}`)
      return route.fulfill({ status: 418, json: { error: { code: 'X', message: 'Fixture' } } })
    })

    for (const [path, name] of [
      ['/platform', 'overview'],
      ['/platform/workspaces', 'workspaces'],
      ['/platform/access-requests', 'access-requests'],
      ['/platform/payments', 'payments'],
      ['/platform/billing-operations', 'billing-operations'],
      ['/platform/plans', 'plans'],
      ['/platform/ai-requests', 'ai-requests'],
      ['/platform/ai-plans', 'ai-plans'],
      ['/platform/email', 'email'],
      ['/platform/audit', 'audit'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await shot(page, `platform-${name}-1440`, true)
      if (['overview', 'workspaces', 'payments', 'billing-operations', 'audit'].includes(name))
        await darkShot(page, `platform-${name}-1440`, true)
      await axe(page)
      if (['workspaces', 'payments', 'billing-operations'].includes(name)) {
        await at(page, 375)
        await noPageOverflow(page)
        await shot(page, `platform-${name}-375`, true)
        await at(page, 1440)
      }
    }

    // Payment review: the approve and reject steps are opened, never submitted.
    await page.goto('/platform/payments')
    await page.getByRole('button', { name: 'Approve FW-INV-000124' }).click()
    const approve = page.getByRole('dialog', { name: 'Approve payment' })
    await expect(approve).toBeVisible()
    await shot(page, 'platform-payment-approve-drawer-1440')
    await darkShot(page, 'platform-payment-approve-drawer-1440')
    await axe(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Reject FW-INV-000119' }).click()
    await expect(page.getByRole('dialog', { name: 'Reject payment' })).toBeVisible()
    await shot(page, 'platform-payment-reject-drawer-1440')
    await page.keyboard.press('Escape')
    await at(page, 375)
    await page.getByRole('button', { name: 'Approve FW-INV-000124' }).click()
    await shot(page, 'platform-payment-approve-drawer-375')
    await page.keyboard.press('Escape')
    await at(page, 1440)

    // Audit detail.
    await page.goto('/platform/audit')
    await page.getByRole('button', { name: /Inspect platform\.payment_proof_viewed/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await shot(page, 'platform-audit-detail-1440')
    await axe(page)
    await page.keyboard.press('Escape')

    // Workspace detail (real fresh workspace) and the commercial adjustment review step.
    await page.goto(`/platform/workspaces/${owner.tenantId}`)
    await expect(page.getByRole('heading', { level: 1, name: LONG })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Workspace invoices' })).toBeVisible()
    await shot(page, 'platform-workspace-detail-1440', true)
    await darkShot(page, 'platform-workspace-detail-1440', true)
    await axe(page)
    for (const width of [768, 375]) {
      await at(page, width)
      await noPageOverflow(page)
      await shot(page, `platform-workspace-detail-${width}`, true)
    }
    await at(page, 1440)
    await page.getByRole('button', { name: 'Start billing adjustment' }).click()
    const drawer = page.getByRole('dialog', { name: 'Commercial operation' })
    await drawer.getByLabel('Amount (INR)').fill('1234567.89')
    await drawer.getByLabel('Reason').fill('Review fixture: preview only, never recorded')
    await drawer.getByLabel('Support / funding reference').fill('REVIEW-FIXTURE-1')
    await drawer.getByRole('button', { name: 'Preview impact' }).click()
    await expect(drawer.getByRole('region', { name: 'Commercial impact preview' })).toBeVisible()
    await shot(page, 'platform-adjustment-preview-1440')
    await darkShot(page, 'platform-adjustment-preview-1440')
    await axe(page)
    await drawer.getByRole('button', { name: 'Review and confirm' }).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Confirm/ }))
    await expect(confirm.first()).toBeVisible()
    await shot(page, 'platform-adjustment-confirm-1440')
    await confirm.first().getByRole('button', { name: 'Cancel' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Create invoice' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Create invoice' })).toBeVisible()
    await shot(page, 'platform-create-invoice-drawer-1440')
    await page.keyboard.press('Escape')
    expect(writes).toEqual([])
  } finally {
    await ownerContext.close()
    operator.revoke()
  }
})
