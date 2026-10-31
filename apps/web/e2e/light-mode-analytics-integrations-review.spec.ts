import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  API,
  customerWritesIn,
  ownerHeaders,
  signInAsNewOwner,
  applyReviewTheme,
  applyWebUpstream,
} from './support'

// REVIEW_THEME=dark runs this review on the dark tokens.
test.beforeEach(async ({ context }) => {
  await applyWebUpstream(context)
  await applyReviewTheme(context)
})

// Light-mode review of Analytics and Integrations. Analytics: the real API responses (genuine
// contract shapes) are read, then filled with deterministic values in the browser only, as in
// analytics-reconstruction.spec.ts. Integrations: records are created through the domain APIs; a
// key's one-time secret is discarded unread and never shown or captured. No provider is
// authorized and no external sync runs. REVIEW_SHOTS_DIR saves review screenshots.
const shots = process.env.REVIEW_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForLoadState('networkidle')
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
  await settled(page)
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([])
}
const noPageOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)

// Deterministic fixture values per series key. SERVICE stays zero to show a real zero category.
const BASE: Record<string, number> = {
  sent: 900,
  delivered: 860,
  read: 690,
  failed: 6,
  opened: 42,
  newConversations: 26,
  resolved: 31,
  completed: 118,
  cancelled: 3,
  stoppedByTakeover: 7,
  inProgress: 5,
  MARKETING: 42_000,
  UTILITY: 18_500,
  AUTHENTICATION: 6_200,
  SERVICE: 0,
}
type Json = Record<string, unknown>
function populate(view: string, data: Json) {
  const meta = data.meta as Json
  meta.freshness = { status: 'READY', lastProcessedAt: new Date().toISOString(), pending: 0 }
  const series = (data.series ?? []) as Array<{ day: string; values: Record<string, number> }>
  const keys =
    view === 'usage'
      ? ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE']
      : Object.keys(series[0]?.values ?? {})
  data.series = series.map((p, i) => ({
    day: p.day,
    values: Object.fromEntries(
      keys.map((k) => [k, Math.round((BASE[k] ?? 10) * (0.8 + ((i * 7) % 10) / 25))]),
    ),
  }))
  const sum = (k: string) =>
    (data.series as Array<{ values: Record<string, number> }>).reduce(
      (total, p) => total + (p.values[k] ?? 0),
      0,
    )
  const kpis = (data.kpis ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(kpis)) {
    if (v && typeof v === 'object' && 'numerator' in v)
      kpis[k] = { value: 0.952, numerator: 9520, denominator: 10000, previous: 0.941 }
    else if (v && typeof v === 'object' && 'value' in v) {
      const value = keys.includes(k) ? sum(k) : k.endsWith('Minor') ? 66_700 : 120
      kpis[k] = { value, previous: Math.round(value * 0.9) }
    } else if (typeof v === 'number') kpis[k] = 18
    else if (v === null) kpis[k] = k.includes('Resolution') ? 5_400 : 258
  }
  // Totals agree with their parts, so screenshots never show impossible figures.
  if (view === 'automations') {
    const total = ['completed', 'failed', 'cancelled', 'stoppedByTakeover', 'inProgress']
      .map(sum)
      .reduce((a, b) => a + b, 0)
    kpis.executions = { value: total, previous: Math.round(total * 0.9) }
  }
  if (view === 'usage') {
    const label: Record<string, string> = {
      MARKETING: 'Marketing',
      UTILITY: 'Utility',
      AUTHENTICATION: 'Authentication',
      SERVICE: 'Service',
    }
    // Service conversations are free: real messages, zero charge.
    const messages: Record<string, number> = {
      MARKETING: 525,
      UTILITY: 1_150,
      AUTHENTICATION: 410,
      SERVICE: 380,
    }
    data.byCategory = keys.map((k) => ({
      key: k,
      label: label[k],
      values: { messages: messages[k], chargeMinor: sum(k) },
    }))
    const billable = keys.filter((k) => sum(k) > 0).reduce((a, k) => a + messages[k]!, 0)
    kpis.billableMessages = { value: billable, previous: Math.round(billable * 0.9) }
    const charge = keys.map(sum).reduce((a, b) => a + b, 0)
    kpis.chargeMinor = { value: charge, previous: Math.round(charge * 0.9) }
  }
  return data
}

test('Analytics: every view, date control, table alternative, states and both themes', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  let mode: 'populated' | 'error' | 'real' = 'populated'
  await page.route('**/api/v1/analytics/**', async (route: Route) => {
    if (mode === 'real') return route.continue()
    if (mode === 'error')
      return route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Analytics couldn’t load.' } },
      })
    const view = new URL(route.request().url()).pathname.split('/').at(-1)!
    const response = await route.fetch()
    await route.fulfill({ response, json: populate(view, (await response.json()) as Json) })
  })
  const views = [
    ['', 'overview'],
    ['/messaging', 'messaging'],
    ['/campaigns', 'campaigns'],
    ['/inbox', 'inbox'],
    ['/automations', 'automations'],
    ['/usage', 'usage'],
  ] as const
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [path, name] of views) {
    await page.goto(`/analytics${path}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(
      page.getByRole('progressbar').or(page.getByLabel('Loading analytics')),
    ).toHaveCount(0)
    await noPageOverflow(page)
    await axe(page)
    await shot(page, `analytics-${name}-1440`, true)
    if (['overview', 'messaging', 'usage', 'automations'].includes(name))
      await darkShot(page, `analytics-${name}-1440`, true)
  }
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await noPageOverflow(page)
    await shot(page, `analytics-overview-${width}`, true)
  }
  await page.goto('/analytics/usage')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await noPageOverflow(page)
  await shot(page, 'analytics-usage-375', true)

  // Not processed yet (the real response) and a load failure stay distinct from zero.
  mode = 'real'
  await page.goto('/analytics/messaging')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await axe(page)
  await shot(page, 'analytics-not-processed-1440', true)
  mode = 'error'
  await page.goto('/analytics')
  await expect(page.getByRole('button', { name: /Try again|Retry/ }).first()).toBeVisible()
  await axe(page)
  await shot(page, 'analytics-error-1440', true)

  // Date control and the chart's table alternative (mode back to populated).
  mode = 'populated'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/analytics/messaging')
  await page.getByRole('combobox', { name: 'Date range' }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await shot(page, 'analytics-date-range-open-1440')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Show as table' }).first().click()
  await expect(page.getByRole('table').first()).toBeVisible()
  await shot(page, 'analytics-messaging-table-1440', true)
  await axe(page)
})

test('Integrations: overview, WhatsApp, API keys, webhooks, connector dialog and both themes', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  await customerWritesIn(page, owner, 'Hello') // connects the mock WhatsApp number
  const headers = ownerHeaders(owner)
  const key = await page.request.post(`${API}/api-keys`, {
    headers,
    data: { name: 'Order system', scopes: ['contacts.read', 'inbox.reply'] },
  })
  expect(key.status()).toBe(201) // the one-time secret is not read, logged or displayed
  const hook = await page.request.post(`${API}/webhook-endpoints`, {
    headers,
    data: {
      name: 'Order system events for the warehouse and dispatch team',
      url: 'https://example.com/acme-demo/webhooks',
      events: ['message.inbound.received', 'campaign.completed'],
    },
  })
  expect(hook.status()).toBe(201)
  const hookId = ((await hook.json()) as { data: { endpoint?: { id: string }; id?: string } }).data
  const endpointId = hookId.endpoint?.id ?? hookId.id!

  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [path, name] of [
    ['/integrations', 'integrations-overview'],
    ['/integrations/whatsapp', 'integrations-whatsapp'],
    ['/integrations/api', 'integrations-api'],
    ['/integrations/webhooks', 'integrations-webhooks'],
    [`/integrations/webhooks/${endpointId}`, 'integrations-webhook-detail'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await noPageOverflow(page)
    await axe(page)
    await shot(page, `${name}-1440`, true)
    await darkShot(page, `${name}-1440`, true)
  }
  for (const [path, name] of [
    ['/integrations', 'integrations-overview'],
    ['/integrations/whatsapp', 'integrations-whatsapp'],
    [`/integrations/webhooks/${endpointId}`, 'integrations-webhook-detail'],
  ] as const) {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await noPageOverflow(page)
    await shot(page, `${name}-375`, true)
  }
  // The ERPNext setup dialog, opened empty and never submitted (no external request).
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/integrations')
  await page.getByRole('button', { name: 'Connect ERPNext' }).click()
  const dialog = page.getByRole('dialog', { name: /Connect ERPNext/ })
  await expect(dialog).toBeVisible()
  await axe(page)
  await shot(page, 'integrations-erpnext-dialog-1440')
})
