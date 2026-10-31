import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockFrontend } from './frontend-fixture'

async function fixture(page: Page, statuses = ['CONNECTED']) {
  await mockFrontend(page, ['inbox.read', 'whatsapp.read', 'workspace.read'])
  await page.route('**/api/v1/whatsapp/connections', (route) =>
    route.fulfill({
      json: {
        data: statuses.map((status, i) => ({
          id: `number-${i}`,
          status,
          displayPhoneNumber: `+91900000000${i}`,
          qualityRating: 'GREEN',
        })),
      },
    }),
  )
  await page.route('**/api/v1/conversations?*', (route) =>
    route.fulfill({ json: { data: [], page: { nextCursor: null } } }),
  )
  await page.route('**/api/v1/conversations/counts?*', (route) =>
    route.fulfill({ json: { data: { all: 0, mine: 0, unassigned: 0 } } }),
  )
  await page.route('**/api/v1/inbox/unread-count', (route) =>
    route.fulfill({ json: { data: { conversations: 3 } } }),
  )
  await page.route('**/api/v1/workspace/status', (route) =>
    route.fulfill({ json: { data: { wallet: { state: 'NOT_ENFORCED' } } } }),
  )
}
const rail = (page: Page) => page.getByRole('complementary', { name: 'Application navigation' })
const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])

test('temporary rail timing, keyboard focus, pin preference and no layout shift', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fixture(page)
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  expect((await sidebar.boundingBox())!.width).toBe(68)
  const mainBefore = await page.locator('main').boundingBox()
  // Use the gutter to test hover without clicking/focusing a link.
  await page.mouse.move(2, 100)
  await page.waitForTimeout(100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(232)
  expect(await page.locator('main').boundingBox()).toEqual(mainBefore)
  await page.mouse.move(500, 20)
  await page.waitForTimeout(150)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  const inbox = sidebar.getByRole('link', { name: /Inbox/ })
  await inbox.focus()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await expect(inbox).toBeFocused()
  await page.waitForTimeout(400)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await sidebar.getByRole('button', { name: 'Pin sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
  await expect(sidebar).toHaveAttribute('data-pinned', 'true')
  expect((await page.locator('main').boundingBox())!.x).toBe(232)
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-pinned', 'true')
  await sidebar.getByRole('button', { name: 'Unpin sidebar' }).click()
  await page.mouse.move(500, 20)
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  expect((await page.locator('main').boundingBox())!.x).toBe(68)
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-pinned', 'false')
  await noOverflow(page)
})

test('mouse-clicked navigation focus does not hold an unpinned sidebar open', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await page.mouse.move(2, 100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  const inbox = sidebar.getByRole('link', { name: /Inbox/ })
  await inbox.click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(inbox).toBeFocused()
  expect(await inbox.evaluate((element) => element.matches(':focus-visible'))).toBe(false)
  await page.mouse.move(600, 20)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false', { timeout: 1500 })
  // Closing the rail must never discard the link's native focus.
  await expect(inbox).toBeFocused()
})

test('keyboard focus takes over from a clicked link, and a later pointer click releases it', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await page.mouse.move(2, 100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  const inbox = sidebar.getByRole('link', { name: /Inbox/ })
  await inbox.click()
  await page.mouse.move(600, 20)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.keyboard.press('Tab')
  const templates = sidebar.getByRole('link', { name: 'Templates', exact: true })
  await expect(templates).toBeFocused()
  expect(await templates.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.waitForTimeout(350)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  // Real keyboard disclosure and child navigation keep the rail open.
  const disclosure = sidebar.getByRole('button', { name: 'Expand Automations', exact: true })
  await disclosure.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await expect(sidebar.getByRole('link', { name: 'Workflows', exact: true })).toBeFocused()
  await page.waitForTimeout(350)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await inbox.focus()
  await inbox.click()
  await page.mouse.move(600, 20)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect(inbox).toBeFocused()
})

test('rapid hover cancels stale timers and uses the 180ms/250ms delays', async ({ page }) => {
  await fixture(page)
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  const time = new Date()
  await page.clock.install({ time })
  await page.clock.pauseAt(new Date(time.getTime() + 1000))
  await page.mouse.move(2, 100)
  await page.clock.runFor(179)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.mouse.move(600, 20)
  await page.clock.runFor(500)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
  await page.mouse.move(2, 100)
  await page.clock.runFor(90)
  // A fast click moves focus out of the header before the hover delay has elapsed.
  // That focusout must not cancel the pending hover expansion.
  await sidebar.getByRole('link', { name: 'Home', exact: true }).click()
  await page.clock.runFor(89)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.clock.runFor(1)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.mouse.move(600, 20)
  await page.clock.runFor(249)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.mouse.move(2, 100)
  await page.clock.runFor(100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.mouse.move(600, 20)
  await page.clock.runFor(249)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.clock.runFor(1)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.clock.runFor(500)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
})

test('the 200ms rail transition keeps navigation icons and page geometry fixed', async ({
  page,
}) => {
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  const geometry = () =>
    sidebar.evaluate((element) => ({
      icons: [...element.querySelectorAll('nav > ul > li > div > a > svg')].map((icon) => {
        const rect = icon.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
      mainX: document.querySelector('main')!.getBoundingClientRect().x,
      mainWidth: document.querySelector('main')!.getBoundingClientRect().width,
    }))
  const before = await geometry()
  await page.mouse.move(2, 100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  const samples = await sidebar.evaluate(async (element) => {
    const snapshots = []
    for (let frame = 0; frame < 20; frame++) {
      await new Promise(requestAnimationFrame)
      snapshots.push({
        icons: [...element.querySelectorAll('nav > ul > li > div > a > svg')].map((icon) => {
          const rect = icon.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }),
        mainX: document.querySelector('main')!.getBoundingClientRect().x,
        mainWidth: document.querySelector('main')!.getBoundingClientRect().width,
      })
    }
    return snapshots
  })
  for (const sample of samples) expect(sample).toEqual(before)
  const transition = await sidebar.evaluate((element) => ({
    property: getComputedStyle(element).transitionProperty,
    duration: getComputedStyle(element).transitionDuration,
    easing: getComputedStyle(element).transitionTimingFunction,
  }))
  expect(transition).toEqual({
    property: 'width, box-shadow',
    duration: '0.2s, 0.2s',
    easing: 'ease-out, ease-out',
  })
  for (const label of await sidebar.locator('.fw-sidebar-label').all()) {
    expect(await label.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap')
  }
  const rootBox = (await sidebar.boundingBox())!
  const pinBox = (await sidebar
    .getByRole('button', { name: 'Pin sidebar', exact: true })
    .boundingBox())!
  expect(pinBox.y - rootBox.y).toBeLessThanOrEqual(16)
  expect(rootBox.x + rootBox.width - pinBox.x - pinBox.width).toBeLessThanOrEqual(16)
  expect(
    await sidebar
      .locator('[data-sidebar-scroll]')
      .evaluate((element) => getComputedStyle(element).flexGrow),
  ).toBe('0')
  await noOverflow(page)
  await page.mouse.move(600, 20)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(68)
  expect(await geometry()).toEqual(before)
})

test('closing an owned pointer menu can restore trigger focus without holding the rail', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/dashboard')
  const sidebar = rail(page)
  await page.mouse.move(2, 100)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await sidebar.evaluate((element) => {
    const trigger = document.createElement('button')
    trigger.id = 'owned-trigger'
    trigger.textContent = 'Owned pointer menu'
    trigger.setAttribute('aria-controls', 'owned-pointer-menu')
    trigger.setAttribute('aria-expanded', 'true')
    element.append(trigger)
    const menu = document.createElement('div')
    menu.id = 'owned-pointer-menu'
    menu.setAttribute('role', 'menu')
    menu.style.position = 'fixed'
    menu.style.top = '100px'
    menu.style.left = '400px'
    menu.innerHTML = '<button role="menuitem">Pointer menu action</button>'
    document.body.append(menu)
  })
  await page.getByRole('menuitem', { name: 'Pointer menu action' }).click()
  await page.mouse.move(600, 20)
  await page.waitForTimeout(350)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.evaluate(() => {
    document.getElementById('owned-pointer-menu')!.remove()
    const trigger = document.getElementById('owned-trigger')!
    trigger.setAttribute('aria-expanded', 'false')
    trigger.focus()
  })
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Owned pointer menu' })).toBeFocused()
})

test('only the rail’s owned portaled menu retains expansion', async ({ page }) => {
  await fixture(page)
  await page.goto('/dashboard')
  await rail(page).getByRole('link', { name: /Inbox/ }).focus()
  // The rail currently has only navigation links/disclosures. Exercise portal ownership with
  // an accessible menu fixture rather than adding unsupported product actions to navigation.
  await rail(page).evaluate((element) => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Owned menu fixture'
    trigger.setAttribute('aria-controls', 'owned-fixture')
    trigger.setAttribute('aria-expanded', 'true')
    element.append(trigger)
    const menu = document.createElement('div')
    menu.id = 'owned-fixture'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = '<button role="menuitem">Owned action</button>'
    document.body.append(menu)
  })
  await page.getByRole('menuitem', { name: 'Owned action' }).focus()
  await page.mouse.move(600, 20)
  await page.waitForTimeout(450)
  await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
  await page.waitForTimeout(400)
  await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
  await page.evaluate(() => document.getElementById('owned-fixture')?.remove())
  await expect(rail(page)).toHaveAttribute('data-expanded', 'false')
})

for (const path of ['/dashboard', '/inbox']) {
  test(`${path}: single profile, responsive header, navigation drawer and axe`, async ({
    page,
  }) => {
    await fixture(page, ['CONNECTED', 'DISCONNECTED'])
    for (const width of [1440, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Workspace account menu' })).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: /WhatsApp: Disconnected · 2 numbers/ }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: /Current workspace/ })).toBeVisible()
      await noOverflow(page)
      if (width === 1440 || width === 375) {
        await axe(page)
        await page.screenshot({
          path: `test-results/shell-${path.slice(1)}-${width}.png`,
          fullPage: true,
        })
      }
      if (width < 1024) {
        await page.getByRole('button', { name: 'Open navigation' }).click()
        const drawer = page.getByRole('dialog', { name: 'Navigation' })
        await expect(drawer).toBeVisible()
        await expect(drawer.getByRole('link', { name: /Inbox/ })).toBeVisible()
        await expect(page.locator('header button').filter({ hasText: 'Account menu' })).toHaveCount(
          1,
        )
        await axe(page)
        await page.keyboard.press('Escape')
        await expect(drawer).toBeHidden()
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
      }
    }
  })
}

for (const [statuses, label] of [
  [['CONNECTED'], 'Connected'],
  [['FLAGGED'], 'Flagged'],
  [['ERROR'], 'Error'],
  [['RESTRICTED'], 'Restricted'],
  [['PENDING'], 'Pending'],
  [[], 'Not connected'],
] as [string[], string][]) {
  test(`WhatsApp ${label} links to existing integrations`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await fixture(page, statuses)
    await page.goto('/dashboard')
    const control = page.getByRole('link', {
      name: `WhatsApp: ${label}. View connections`,
      exact: true,
    })
    await expect(control).toBeVisible()
    await expect(control).toHaveAttribute('href', '/integrations/whatsapp')
    await control.focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await noOverflow(page)
    if (label !== 'Connected') await expect(control).toContainText(label)
  })
}

test('loading and unavailable connection data never imply disconnected', async ({ page }) => {
  await fixture(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/whatsapp/connections', async (route) => {
    await gate
    await route.fulfill({
      status: 403,
      json: { error: { code: 'FORBIDDEN', message: 'Unavailable' } },
    })
  })
  await page.goto('/dashboard')
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Loading. View connections', exact: true }),
  ).toBeVisible()
  release()
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Status unavailable. View connections', exact: true }),
  ).toBeVisible()
})

test('workspace menu and account actions remain available', async ({ page }) => {
  await fixture(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /Current workspace/ }).click()
  await expect(page.getByRole('menuitem', { name: /Preview workspace/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Create workspace' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Security', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeFocused()
})

test('touch desktop uses explicit navigation drawer', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await fixture(page)
  await page.goto('/inbox')
  await expect(rail(page)).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible()
  await context.close()
})

test('workspace switching refreshes connection data with the selected tenant', async ({ page }) => {
  await fixture(page)
  const membership = {
    membershipId: 'one-member',
    tenantId: 'one',
    tenantName: 'First workspace with a long name',
    tenantSlug: 'one',
    role: 'OWNER',
    permissions: ['inbox.read', 'whatsapp.read', 'workspace.read'],
    require2fa: false,
  }
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: 'preview-user',
            name: 'Preview owner',
            email: 'preview@fenwira.test',
            emailVerified: true,
          },
          memberships: [
            membership,
            {
              ...membership,
              membershipId: 'two-member',
              tenantId: 'two',
              tenantName: 'Second workspace',
              tenantSlug: 'two',
            },
          ],
          csrfToken: 'preview-csrf',
          features: { managedLaunch: false },
          session: null,
        },
      },
    }),
  )
  await page.route('**/api/v1/whatsapp/connections', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'number',
            displayPhoneNumber: '+919000000000',
            qualityRating: 'GREEN',
            status:
              route.request().headers()['x-tenant-id'] === 'two' ? 'DISCONNECTED' : 'CONNECTED',
          },
        ],
      },
    }),
  )
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/dashboard')
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Connected. View connections', exact: true }),
  ).toBeVisible()
  await rail(page).getByRole('link', { name: /Inbox/ }).focus()
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click()
  await noOverflow(page)
  await page.getByRole('button', { name: /Current workspace/ }).click()
  await page.getByRole('menuitem', { name: 'Second workspace' }).click()
  await expect(
    page.getByRole('button', { name: /Current workspace: Second workspace/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'WhatsApp: Disconnected. View connections', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fenwira.tenant'))).toBe('two')
})

test('dark tokens, reduced motion, short rail scrolling and mobile navigation keep working', async ({
  page,
}) => {
  await fixture(page, ['FLAGGED'])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 320 })
  await page.goto('/dashboard')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await rail(page).getByRole('link', { name: /Inbox/ }).focus()
  await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
  expect(
    await rail(page).evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.01)
  const scroller = rail(page).locator('[data-sidebar-scroll]')
  expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  )
  await rail(page).getByRole('link', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded()
  await expect(rail(page).getByRole('link', { name: 'Settings', exact: true })).toBeInViewport()
  await noOverflow(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await axe(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await axe(page)
  await page.keyboard.press('Tab')
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await drawer.getByRole('link', { name: /Inbox/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(drawer).toBeHidden()
})

test('no WhatsApp permission hides the control without fetching connections', async ({ page }) => {
  await mockFrontend(page, ['inbox.read'])
  await page.route('**/api/v1/conversations?*', (route) =>
    route.fulfill({ json: { data: [], page: { nextCursor: null } } }),
  )
  let requests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/whatsapp/connections')) requests++
  })
  await page.goto('/inbox')
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
  await expect(page.locator('header a[href="/integrations/whatsapp"]')).toHaveCount(0)
  expect(requests).toBe(0)
})
