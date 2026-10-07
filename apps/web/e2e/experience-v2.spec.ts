import AxeBuilder from '@axe-core/playwright'
import { chromium, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { type Conversation, type WhatsAppConnection } from '@fenwira/contracts'
import {
  API,
  MOCK,
  PASSWORD,
  customerWritesIn,
  linkFromEmail,
  ownerHeaders,
  signInAsNewOwner,
  uniqueEmail,
} from './support'

const WIDTHS = [1440, 1024, 768, 375]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const run = promisify(execFile)

test('Home is attention first, uses real activity and stays accessible at four widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'ui-ev2', 'Acme Retail')
  const customer = await customerWritesIn(page, owner, 'Can you help with my order?')
  for (const [path, name] of [
    ['campaigns', 'October customer update'],
    ['flows', 'Customer welcome'],
  ] as const) {
    const created = await page.request.post(`${API}/${path}`, {
      data: { name },
      headers: ownerHeaders(owner),
    })
    expect(created.status(), await created.text()).toBe(201)
  }
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Needs attention' })
      .getByText(/conversation waiting for an owner/),
  ).toBeVisible()
  const recent = page.getByRole('list', { name: 'Recent conversations' })
  await expect(recent.getByText(customer)).toBeVisible()
  await expect(page.getByRole('link', { name: 'October customer update' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Customer welcome', exact: true })).toBeVisible()
  const beforeMetrics = await page
    .getByRole('region', { name: 'Needs attention' })
    .evaluate((el) =>
      Boolean(
        el.compareDocumentPosition(document.querySelector('[aria-label="Workspace summary"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    )
  expect(beforeMetrics).toBe(true)
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: /Welcome back,/, exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true })
  }
  await recent.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/inbox\?c=/)
})

test('Home failures are explained rather than represented as empty activity', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-ev2-error')
  await page.route('**/api/v1/conversations?view=all&limit=5', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }),
    }),
  )
  await page.goto('/dashboard')
  await expect(page.getByRole('alert').getByText('Conversations couldn’t be loaded')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('New customer conversations will appear here.')).toHaveCount(0)
  await page.unroute('**/api/v1/conversations?view=all&limit=5')
  await page
    .getByRole('alert')
    .filter({ hasText: 'Conversations couldn’t be loaded' })
    .getByRole('button', { name: 'Try again' })
    .click()
  await expect(page.getByText('New customer conversations will appear here.')).toBeVisible()
})

test('Inbox views, reply/note and sequential context stay accessible at four widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'ui-ev2-inbox', 'Acme Retail')
  const customer = await customerWritesIn(page, owner, 'Can you confirm the delivery date?')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/inbox')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await expect(list.getByText(customer)).toBeVisible()
  const views = page.getByRole('navigation', { name: 'Inbox views' })
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/conversations') &&
        new URL(r.url()).searchParams.get('unread') === 'true',
    ),
    views.getByRole('button', { name: 'Unread', exact: true }).click(),
  ])
  await expect(views.getByRole('button', { name: 'Unread', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await views.getByRole('button', { name: 'All', exact: true }).click()
  await list.getByText(customer).click()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Can you confirm the delivery date?'),
  ).toBeVisible()
  await page.getByLabel('Reply', { exact: true }).fill('I’ll check the delivery for you.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('I’ll check the delivery for you.'),
  ).toBeVisible()
  await expect(page.getByLabel('Reply', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).not.toHaveAttribute(
    'aria-busy',
    'true',
  )
  await page.getByRole('button', { name: 'Internal note', exact: true }).click()
  await page
    .getByLabel('Internal note', { exact: true })
    .fill('Delivery needs a follow-up tomorrow.')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Delivery needs a follow-up tomorrow.'),
  ).toBeVisible()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText(/Internal note ·/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`inbox-${width}.png`), fullPage: true })
    if (width < 1280) {
      await page.getByRole('button', { name: 'Contact details' }).click()
      await expect(
        page
          .getByRole('dialog', { name: 'Contact', exact: true })
          .getByRole('region', { name: 'Messaging eligibility' }),
      ).toBeVisible()
      expect(
        (await new AxeBuilder({ page }).withTags(TAGS).include('[data-slot="drawer"]').analyze())
          .violations,
      ).toEqual([])
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Contact details' })).toBeFocused()
    }
  }
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(list.getByText(customer)).toBeVisible()
})

test('Inbox displays server window and connection states without inventing eligibility', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-ev2-window')
  const customer = await customerWritesIn(page, owner, 'Window fixture')
  let open = false
  await page.route(/\/api\/v1\/conversations\/[^/?]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    const expiresAt = new Date(Date.now() + (open ? 30 : -1) * 60_000).toISOString()
    body.data = {
      ...body.data,
      serviceWindow: { isOpen: open, expiresAt },
      serviceWindowExpiresAt: expiresAt,
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  await expect(
    page.getByText(
      'The 24-hour window has closed. Send an approved template to restart the conversation.',
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Reply', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose a template' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  open = true
  await page.reload()
  await expect(page.getByText(/The 24-hour window closes in/)).toBeVisible()
  await page.route('**/api/v1/whatsapp/connections', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.data = body.data.map((c: WhatsAppConnection) => ({ ...c, status: 'DISCONNECTED' }))
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await expect(page.getByText('WhatsApp connection needs attention', { exact: true })).toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
})

test('Inbox read-only membership cannot compose or reveal financial navigation', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-ev2-viewer')
  const customer = await customerWritesIn(page, owner, 'Read-only conversation')
  const email = uniqueEmail('ui-ev2-reader'),
    since = Date.now()
  const invitation = await page.request.post(`${API}/team/invitations`, {
    data: { email, role: 'VIEWER' },
    headers: ownerHeaders(owner),
  })
  expect(invitation.status()).toBe(201)
  const token = (await linkFromEmail(email, '/invitations/', since)).split('/invitations/')[1]
  const context = await browser.newContext()
  try {
    const viewer = await context.newPage()
    const accepted = await viewer.request.post(`${API}/invitations/${token}/accept`, {
      data: { name: 'Read-only member', password: PASSWORD },
    })
    expect(accepted.status()).toBe(200)
    await viewer.goto('/inbox')
    await viewer.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
    await expect(
      viewer.getByText('Your role can read conversations but cannot reply or add internal notes.'),
    ).toBeVisible()
    await expect(viewer.getByLabel('Reply', { exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0)
    await expect(
      viewer.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Billing' }),
    ).toHaveCount(0)
    await expect(viewer.getByRole('link', { name: /Platform/ })).toHaveCount(0)
    expect((await new AxeBuilder({ page: viewer }).withTags(TAGS).analyze()).violations).toEqual([])
  } finally {
    await context.close()
  }
})

test('Inbox preserves a draft while a reply awaits server confirmation', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-ev2-pending')
  const customer = await customerWritesIn(page, owner, 'Pending-send fixture')
  const canned = await page.request.post(`${API}/canned-replies`, {
    headers: ownerHeaders(owner),
    data: { shortcut: '/wait', title: 'Please wait', body: 'I’m checking this for you.' },
  })
  expect(canned.status(), await canned.text()).toBe(201)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  await page.route('**/api/v1/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    received()
    await gate
    await route.fulfill({ response })
  })
  try {
    await page.goto('/inbox')
    await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
    await page.getByLabel('Reply', { exact: true }).fill('Reply awaiting confirmation')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await committed
    await expect(page.getByRole('button', { name: 'Internal note', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Reply', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Canned replies', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue(
      'Reply awaiting confirmation',
    )
  } finally {
    release()
  }
  await expect(page.getByLabel('Reply', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('Reply', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Internal note', exact: true }).click()
  await page.getByLabel('Internal note', { exact: true }).fill('A separate internal draft')
  await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue(
    'A separate internal draft',
  )
})

test('Inbox reconnect refreshes messages missed while the socket was offline', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-ev2-reconnect')
  const customer = await customerWritesIn(page, owner, 'Before reconnect')
  await page.addInitScript(() => {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket
        ;(window as Window & { ev2Socket?: WebSocket }).ev2Socket = socket
        return socket
      },
    })
  })
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Before reconnect'),
  ).toBeVisible()
  const selectedId = new URL(page.url()).searchParams.get('c')!
  const conversation = (
    await (
      await page.request.get(`${API}/conversations/${selectedId}`, { headers: ownerHeaders(owner) })
    ).json()
  ).data as Conversation
  const connections = (
    await (
      await page.request.get(`${API}/whatsapp/connections`, { headers: ownerHeaders(owner) })
    ).json()
  ).data as WhatsAppConnection[]
  const connection = connections.find((c) => c.id === conversation.phoneNumber.id)!
  await page.context().setOffline(true)
  await page.evaluate(() => (window as Window & { ev2Socket?: WebSocket }).ev2Socket?.close())
  const incoming = await fetch(`${MOCK}/__mock/inbound`, {
    method: 'POST',
    body: JSON.stringify({
      phoneNumberId: connection.phoneNumberId,
      from: conversation.contact.phoneE164.replace('+', ''),
      name: customer,
      text: 'Received while disconnected',
    }),
  })
  expect(incoming.ok).toBe(true)
  // The actual worker persists this before reconnect; no UI response fixture supplies the message.
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`${API}/conversations/${conversation.id}/messages`, {
          headers: ownerHeaders(owner),
        })
      ).json()
      return JSON.stringify(body.data).includes('Received while disconnected')
    })
    .toBe(true)
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Received while disconnected'),
  ).toHaveCount(0)
  await page.context().setOffline(false)
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Received while disconnected'),
  ).toBeVisible({ timeout: 15_000 })
})

test('Experience V2 Home and populated Inbox meet the Lighthouse accessibility gate', async ({
  page,
}) => {
  test.skip(
    process.env.EV2_LIGHTHOUSE !== 'true',
    'Set EV2_LIGHTHOUSE=true for the explicit checkpoint audit',
  )
  test.setTimeout(180_000)
  const owner = await signInAsNewOwner(page, 'ui-ev2-lighthouse')
  const customer = await customerWritesIn(page, owner, 'Accessibility fixture')
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  const selected = new URL(page.url()).search
  const directory = resolve(__dirname, '../test-results/experience-v2-lighthouse')
  mkdirSync(directory, { recursive: true })
  const profile = resolve(directory, 'chrome-profile')
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--remote-debugging-port=9335', '--remote-debugging-address=127.0.0.1'],
  })
  const scores: Array<{ path: string; score: number; failing: string[] }> = []
  try {
    await context.addCookies(await page.context().cookies())
    for (const path of ['/dashboard', `/inbox${selected}`]) {
      const output = resolve(directory, 'result.json')
      const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
      await run(
        'pnpm',
        [
          'dlx',
          'lighthouse@12.8.2',
          `${base}${path}`,
          '--port=9335',
          '--only-categories=accessibility',
          '--output=json',
          `--output-path=${output}`,
          '--quiet',
          '--disable-storage-reset',
        ],
        { cwd: resolve(__dirname, '../../..'), timeout: 60_000 },
      )
      const report = JSON.parse(readFileSync(output, 'utf8'))
      expect(new URL(report.finalDisplayedUrl).pathname).toBe(new URL(`${base}${path}`).pathname)
      const score = report.categories.accessibility.score * 100
      const failing = Object.entries(report.audits)
        .filter(([, a]) => (a as { score: number | null }).score === 0)
        .map(([id]) => id)
      scores.push({ path: new URL(`${base}${path}`).pathname, score, failing })
      expect(score, path).toBeGreaterThanOrEqual(95)
    }
    writeFileSync(
      resolve(directory, 'scores.json'),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), lighthouse: '12.8.2', category: 'accessibility', finalUrlsVerified: true, scores }, null, 2)}\n`,
    )
  } finally {
    await context.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(resolve(directory, 'result.json'), { force: true })
  }
})
