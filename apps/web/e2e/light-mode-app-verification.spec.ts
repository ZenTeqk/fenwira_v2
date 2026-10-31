import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  API,
  PASSWORD,
  linkFromEmail,
  resetRateLimits,
  signInAsNewOwner,
  uniqueEmail,
  applyReviewTheme,
  applyWebUpstream,
  reviewTheme,
} from './support'

// REVIEW_THEME=dark runs this review on the dark tokens.
test.beforeEach(async ({ context }) => {
  await applyWebUpstream(context)
  await applyReviewTheme(context)
})

// Application-wide light-mode verification: every route family at 375/768/1440, with axe, a
// document-level horizontal-overflow check (wide tables may scroll inside their own container) and
// screenshots. Fixtures are local accounts on the isolated stack; nothing is sent, paid, invited or
// connected. REVIEW_SHOTS_DIR saves screenshots and `routes.jsonl` (one result per route/width).

// REVIEW_SHOT_WIDTHS=1440,375 limits which widths are captured (all widths are still checked).
const shotWidths = process.env.REVIEW_SHOT_WIDTHS?.split(',').map(Number)
const shots = process.env.REVIEW_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const record = (row: Record<string, unknown>) => {
  if (shots) appendFileSync(join(shots, 'routes.jsonl'), `${JSON.stringify(row)}\n`)
}
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
const slug = (path: string) =>
  path
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-$/, '') || 'root'

/** Elements or text past the right edge that no in-viewport scroll container clips. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const amount = document.documentElement.scrollWidth - document.documentElement.clientWidth
    if (amount <= 0) return { amount, culprits: [] as string[] }
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX
        if (x !== 'visible' && p.getBoundingClientRect().right <= innerWidth + 1) return true
      }
      return false
    }
    const culprits: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > innerWidth + 1 && !clipped(el))
        culprits.push(
          `${el.tagName.toLowerCase()}.${String(el.getAttribute('class')).slice(0, 60)}`,
        )
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width && r.right > innerWidth + 1 && n.parentElement && !clipped(n.parentElement))
        culprits.push(`text "${(n.textContent ?? '').slice(0, 40)}"`)
    }
    return { amount, culprits: culprits.slice(0, 5) }
  })
const axeViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target).slice(0, 3) }))

/** Visit a route at each width; assert no page overflow and no axe violations; screenshot. */
async function verify(page: Page, family: string, path: string, widths = [1440, 768, 375]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1').first(), `${path} @${width}`).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
    await settled(page)
    // Guard against a silent light run when the dark review is requested.
    if (reviewTheme)
      expect(await page.evaluate(() => document.documentElement.dataset.theme), path).toBe('dark')
    const o = await overflow(page)
    const violations = width === 1440 || width === 375 ? await axeViolations(page) : []
    const final = new URL(page.url()).pathname
    record({
      family,
      path,
      final,
      width,
      overflow: o.amount,
      culprits: o.culprits,
      axe: violations,
    })
    if (shots && (shotWidths ? shotWidths.includes(width) : width !== 768 || family === 'auth'))
      await page.screenshot({
        path: join(shots, `${family}-${slug(path)}-${width}.png`),
        animations: 'disabled',
      })
    expect.soft(o.amount, `${path} @${width}: ${o.culprits.join(' | ')}`).toBeLessThanOrEqual(0)
    expect.soft(violations, `${path} @${width} axe`).toEqual([])
  }
}

test.beforeEach(() => resetRateLimits())

test('auth, recovery, MFA, invitation, platform login and not-found screens', async ({ page }) => {
  test.setTimeout(300_000)
  for (const path of [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password?token=review-invalid-token',
    '/invitations/review-invalid-token',
    '/platform/login',
    '/this-route-does-not-exist',
  ])
    await verify(page, 'auth', path)

  // MFA challenge screen: a placeholder challenge renders it; a wrong code only returns an error.
  await page.addInitScript(() =>
    sessionStorage.setItem('fenwira.mfa-challenge', 'review-placeholder'),
  )
  await verify(page, 'auth', '/two-factor')
  await page.getByLabel(/code/i).first().fill('000000')
  await page
    .getByRole('button', { name: /verify/i })
    .first()
    .click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, 'auth-two-factor-error-375.png') })

  // Client and server validation on the sign-in form (unknown account; nothing is created).
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/login')
  await page.getByLabel('Email').fill('nobody-review@fenwira.test')
  await page.getByLabel('Password').fill('not-the-password-123')
  await page
    .getByRole('button', { name: /sign in|log in|continue/i })
    .first()
    .click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, 'auth-login-error-1440.png') })
  expect((await axeViolations(page)).map((v) => v.id)).toEqual([])
})

test('verify-email and onboarding for a new account', async ({ page }) => {
  test.setTimeout(180_000)
  const email = uniqueEmail('lm-onboarding')
  const since = Date.now()
  const reg = await page.request.post(`${API}/auth/register`, {
    data: { name: 'Venkata Subramanian Ramachandran Iyer', email, password: PASSWORD },
  })
  expect(reg.status()).toBe(201)
  const csrf = (await reg.json()).data.csrfToken as string
  await verify(page, 'auth', '/verify-email')
  const token = new URL(await linkFromEmail(email, '/verify-email', since)).searchParams.get(
    'token',
  )
  expect(
    (
      await page.request.post(`${API}/auth/email/verify`, {
        data: { token },
        headers: { 'X-CSRF-Token': csrf },
      })
    ).status(),
  ).toBe(204)
  await verify(page, 'onboarding', '/onboarding')
  await page.getByRole('combobox').first().click()
  if (shots) await page.screenshot({ path: join(shots, 'onboarding-country-open-1440.png') })
  await page.keyboard.press('Escape')
})

const APP_ROUTES: Array<[string, string]> = [
  ['home', '/dashboard'],
  ['inbox', '/inbox'],
  ['contacts', '/contacts'],
  ['contacts', '/contacts/imports'],
  ['contacts', '/contacts/segments'],
  ['contacts', '/contacts/tags'],
  ['templates', '/templates'],
  ['templates', '/templates/new'],
  ['campaigns', '/campaigns'],
  ['campaigns', '/campaigns/new'],
  ['campaigns', '/campaigns/analytics'],
  ['automations', '/automations'],
  ['automations', '/automations/workflows'],
  ['automations', '/automations/new'],
  ['automations', '/automations/reply-studio'],
  ['automations', '/automations/reply-studio/auto-replies'],
  ['automations', '/automations/reply-studio/bot-flows'],
  ['automations', '/automations/reply-studio/business-hours'],
  ['automations', '/automations/reply-studio/new'],
  ['automations', '/automations/reply-studio/reports'],
  ['ai', '/ai-assistant'],
  ['analytics', '/analytics'],
  ['analytics', '/analytics/messaging'],
  ['analytics', '/analytics/campaigns'],
  ['analytics', '/analytics/inbox'],
  ['analytics', '/analytics/automations'],
  ['analytics', '/analytics/usage'],
  ['integrations', '/integrations'],
  ['integrations', '/integrations/whatsapp'],
  ['integrations', '/integrations/api'],
  ['integrations', '/integrations/webhooks'],
  ['billing', '/billing/wallet'],
  ['billing', '/billing/subscription'],
  ['billing', '/billing/invoices'],
  ['settings', '/settings/workspace'],
  ['settings', '/settings/team'],
  ['settings', '/settings/roles'],
  ['settings', '/settings/whatsapp'],
  ['settings', '/settings/security'],
  ['settings', '/settings/audit-logs'],
]

test('every customer route family at 375, 768 and 1440', async ({ page }) => {
  test.setTimeout(900_000)
  await signInAsNewOwner(page, 'lm-verify', 'Sri Lakshmi Narasimha Handloom Silk Sarees Pvt Ltd')
  for (const [family, path] of APP_ROUTES) await verify(page, family, path)
  // Redirecting entries land on a real page.
  for (const [from, to] of [
    ['/', '/dashboard'],
    ['/billing', '/billing/'],
    ['/billing/usage', '/analytics/usage'],
    ['/settings', '/settings/workspace'],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(new RegExp(to.replace(/\//g, '\\/')))
    record({ family: 'redirect', path: from, final: new URL(page.url()).pathname })
  }
})

test('access denied, shared overlays, focus trap and restoration', async ({ page }) => {
  test.setTimeout(240_000)
  await signInAsNewOwner(page, 'lm-overlays', 'Coastal Spices')
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Dialog: focus moves in, Tab stays inside, Escape returns focus to the trigger.
  await page.goto('/contacts')
  const trigger = page.getByRole('button', { name: 'Add contact' }).first()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'New contact' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  }
  if (shots) await page.screenshot({ path: join(shots, 'overlay-dialog-1440.png') })
  expect((await axeViolations(page)).map((v) => v.id)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // Dialog at 375: fits the viewport.
  await page.setViewportSize({ width: 375, height: 800 })
  await trigger.click()
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375)
  if (shots) await page.screenshot({ path: join(shots, 'overlay-dialog-375.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Command palette (Control K) and the account dropdown, both keyboard-operable.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Search and jump to (Control K)' }).click()
  await expect(page.getByRole('dialog').first()).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, 'overlay-command-palette-1440.png') })
  expect((await axeViolations(page)).map((v) => v.id)).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Account menu/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  if (shots) await page.screenshot({ path: join(shots, 'overlay-account-menu-1440.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Access denied: the same owner without billing permissions (browser-side session only).
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const m of body.data.memberships)
      m.permissions = m.permissions.filter((p: string) => !p.startsWith('billing.'))
    await route.fulfill({ response, json: body })
  })
  await page.goto('/billing/wallet')
  await expect(page.getByText(/permission|access/i).first()).toBeVisible()
  await settled(page)
  if (shots) await page.screenshot({ path: join(shots, 'state-access-denied-1440.png') })
  expect((await axeViolations(page)).map((v) => v.id)).toEqual([])
  record({ family: 'state', path: '/billing/wallet (no billing.read)', final: 'PermissionState' })

  // Load error: a failing list shows the shared error state with retry.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.route('**/api/v1/contacts/search', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
    }),
  )
  await page.goto('/contacts')
  await expect(page.getByRole('button', { name: /try again|retry/i }).first()).toBeVisible({
    timeout: 20_000,
  })
  if (shots) await page.screenshot({ path: join(shots, 'state-load-error-1440.png') })
  expect((await axeViolations(page)).map((v) => v.id)).toEqual([])
  record({ family: 'state', path: '/contacts (503)', final: 'ErrorState' })
})
