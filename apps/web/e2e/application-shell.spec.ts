import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockFrontend } from './frontend-fixture'

async function fixture(page: Page, statuses = ['CONNECTED'], tenantName?: string) {
  await mockFrontend(page, ['inbox.read', 'whatsapp.read', 'workspace.read'], { tenantName })
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
    // Main modules fill the rail and scroll; Integrations, Billing and Settings stay at its foot.
  ).toBe('1')
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
        page.getByRole('button', { name: /^WhatsApp: 1 of 2 numbers not connected/ }),
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

const WHATSAPP_STATES: Array<[string[], string, string]> = [
  [['CONNECTED'], 'Connected', 'connected'],
  [['FLAGGED'], 'Needs attention', 'attention'],
  [['PENDING'], 'Setup pending', 'attention'],
  [['ERROR'], 'Error', 'disconnected'],
  [['RESTRICTED'], 'Restricted', 'disconnected'],
  [[], 'Not connected', 'disconnected'],
  [['CONNECTED', 'FLAGGED'], '1 of 2 numbers need attention', 'attention'],
]
for (const [statuses, label, health] of WHATSAPP_STATES) {
  for (const scheme of ['light', 'dark'] as const)
    test(`WhatsApp ${label} (${scheme}): indicator, details popover and keyboard access`, async ({
      page,
    }) => {
      // Appearance defaults to System, so the OS scheme selects the theme.
      await page.emulateMedia({ colorScheme: scheme })
      await fixture(page, statuses)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/dashboard')
      const control = page.getByRole('button', {
        name: `WhatsApp: ${label}. Show connection details`,
        exact: true,
      })
      await expect(control).toHaveAttribute('data-health', health)
      const short = {
        connected: 'WhatsApp',
        disconnected: 'Disconnected',
        attention: 'Needs attention',
      }[health]!
      await expect(control).toHaveText(short)
      if (health === 'connected') {
        // Healthy: green dot and "WhatsApp", with a tooltip.
        await control.focus()
        await expect(page.getByRole('tooltip', { name: 'WhatsApp connected' })).toBeVisible()
      }

      // Keyboard: Enter opens the details; numbers, statuses and the link; Escape returns focus.
      await control.focus()
      await page.keyboard.press('Enter')
      const details = page.getByRole('dialog')
      await expect(details).toContainText(`WhatsApp · ${label}`)
      await expect(details).toContainText('doesn’t guarantee that every message is delivered')
      const numbers = details.getByRole('list', { name: 'WhatsApp numbers' })
      await expect(numbers.getByRole('listitem')).toHaveCount(statuses.length)
      await expect(details.getByRole('link', { name: 'View connection' })).toHaveAttribute(
        'href',
        '/integrations/whatsapp',
      )
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role="dialog"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([])
      await page.keyboard.press('Escape')
      await expect(details).toHaveCount(0)
      await expect(control).toBeFocused()

      // Mobile: a compact, accessible control; details on tap; no page overflow.
      await page.setViewportSize({ width: 375, height: 812 })
      await expect(control).toBeVisible()
      await noOverflow(page)
      await control.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      const box = (await page.getByRole('dialog').boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(375)
      await noOverflow(page)
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
    page.getByRole('button', { name: 'WhatsApp: Checking. Show connection details', exact: true }),
  ).toHaveAttribute('data-health', 'checking')
  release()
  await expect(
    page.getByRole('button', {
      name: 'WhatsApp: Status unavailable. Show connection details',
      exact: true,
    }),
  ).toHaveAttribute('data-health', 'unavailable')
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
    page.getByRole('button', { name: 'WhatsApp: Connected. Show connection details', exact: true }),
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
    page.getByRole('button', {
      name: 'WhatsApp: Disconnected. Show connection details',
      exact: true,
    }),
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

/** Relative luminance of a computed `rgb()` colour (dark surfaces are well below 0.2). */
const luminance = (page: Page, selector: string, property = 'backgroundColor') =>
  page
    .locator(selector)
    .first()
    .evaluate((element, prop) => {
      const [r, g, b] = getComputedStyle(element)
        [prop as 'backgroundColor']!.match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map((v) => Number(v) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }, property)

test('Appearance: System by default, Light/Dark persist across reloads, OS changes only in System', async ({
  page,
}) => {
  const hydration: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat/i.test(m.text())) hydration.push(m.text())
  })
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/dashboard')
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  // No stored preference: System, following the OS (dark, then light).
  expect(await theme()).toBe('dark')
  const trigger = page.getByRole('button', { name: /^Appearance: / })
  await expect(trigger).toHaveAccessibleName('Appearance: System')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(theme).toBe('light')

  // The menu shows the selected option and is themed like the page (portaled under <html>).
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // An open menu aria-hides the page (see a11y.spec), so audit the menu itself.
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-slot="dropdown-content"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await menu.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect.poll(theme).toBe('dark')
  await expect(trigger).toHaveAccessibleName('Appearance: Dark')
  expect(await page.evaluate(() => localStorage.getItem('fenwira.theme'))).toBe('dark')
  await trigger.click()
  expect(await luminance(page, '[data-slot="dropdown-content"]')).toBeLessThan(0.2)
  await page.keyboard.press('Escape')

  // An explicit choice survives a reload, is applied before first paint and ignores the OS.
  await page.addInitScript(() => {
    ;(window as unknown as { __firstTheme?: string }).__firstTheme = undefined
    document.addEventListener(
      'DOMContentLoaded',
      () =>
        ((window as unknown as { __firstTheme?: string }).__firstTheme =
          document.documentElement.dataset.theme),
      { once: true },
    )
  })
  await page.reload()
  expect(
    await page.evaluate(() => (window as unknown as { __firstTheme?: string }).__firstTheme),
  ).toBe('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(200)
  expect(await theme()).toBe('dark')
  expect(await luminance(page, 'header')).toBeLessThan(0.2)

  // Light by choice, then back to System (preference removed; the OS applies again).
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'Light' }).click()
  await expect.poll(theme).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(200)
  expect(await theme()).toBe('light')
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'System' }).click()
  await expect.poll(theme).toBe('dark')
  expect(await page.evaluate(() => localStorage.getItem('fenwira.theme'))).toBeNull()
  expect(hydration).toEqual([])
})

test('Help lives in the account menu; the header has the Appearance control instead', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/dashboard')
  await expect(page.getByRole('banner').getByRole('button', { name: 'Help' })).toHaveCount(0)
  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Account menu/ })).toBeFocused()
})

test('sidebar rows, utilities group, badge placement and collapsed-only tooltips', async ({
  page,
}) => {
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  const nav = rail(page).getByRole('navigation', { name: 'Main' })
  const inbox = nav.getByRole('link', { name: /Inbox/ })
  // Collapsed: the count is a compact badge over the icon (labels are hidden).
  const collapsedBadge = (await inbox.locator('.fw-sidebar-badge').boundingBox())!
  expect(collapsedBadge.x + collapsedBadge.width).toBeLessThanOrEqual(68)
  // Hovering expands the rail (180ms) before a tooltip could open (300ms); expanded rows show
  // their label, so the tooltip stays closed. Pin to inspect the expanded rows.
  await inbox.hover()
  await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
  await rail(page).getByRole('button', { name: 'Pin sidebar' }).click()
  await expect(rail(page)).toHaveAttribute('data-pinned', 'true')
  const box = (await inbox.boundingBox())!
  expect(Math.round(box.height)).toBe(44)
  expect(
    await inbox
      .locator('svg')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(20)
  expect(await inbox.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
  const badge = inbox.locator('.fw-sidebar-badge')
  const badgeBox = (await badge.boundingBox())!
  expect(box.x + box.width - (badgeBox.x + badgeBox.width)).toBeLessThanOrEqual(16)
  await inbox.hover()
  await page.waitForTimeout(600)
  await expect(page.getByRole('tooltip', { name: 'Inbox' })).toHaveCount(0)
  // Utilities sit in their own group below a divider, outside the scrolling list.
  const utilities = nav.getByRole('list', { name: 'Workspace' })
  await expect(utilities.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  expect(await utilities.evaluate((el) => !el.closest('[data-sidebar-scroll]'))).toBe(true)
  await axe(page)
  await rail(page).getByRole('button', { name: 'Unpin sidebar' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await noOverflow(page)
})

for (const theme of ['light', 'dark'] as const) {
  test(`no floating sidebar labels after hovering or tabbing across items (${theme})`, async ({
    page,
  }) => {
    await fixture(page)
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard')
    const nav = rail(page).getByRole('navigation', { name: 'Main' })
    const links = nav.getByRole('link')
    // Every navigation link keeps an accessible name from its own text (no tooltip needed).
    for (const link of await links.all()) expect(await link.textContent()).toMatch(/\w/)

    /** Nothing from the rail floats over page content, at each nav row's height. */
    const nothingOverContent = async () => {
      await expect(rail(page)).toHaveAttribute('data-expanded', 'false')
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      const rows = await links.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top + 22),
      )
      // Poll: the 200ms width transition finishes after data-expanded flips.
      for (const y of rows)
        await expect
          .poll(
            () =>
              page.evaluate((y) => {
                const el = document.elementFromPoint(120, y)
                return el?.closest('aside, [role="tooltip"]')
                  ? `${el.tagName} ${el.textContent?.slice(0, 30)}`
                  : null
              }, y),
            { message: `nothing from the rail over content at y=${y}` },
          )
          .toBeNull()
    }

    // Pointer: sweep across several items (expanding the rail), then leave for page content.
    const all = await links.all()
    expect(all.length).toBeGreaterThanOrEqual(4)
    for (const link of all) await link.hover()
    await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
    await page.mouse.move(900, 450)
    await nothingOverContent()

    // Keyboard: Tab into the rail (expands at once with a visible focus ring), through several
    // items, then out to the page; it collapses with nothing left behind.
    await page.locator('main').focus()
    await nav.getByRole('link', { name: /^Home/ }).focus()
    await expect(rail(page)).toHaveAttribute('data-expanded', 'true')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
    // The focused control draws the shared focus ring (a solid outline).
    expect(await page.locator(':focus').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
      'solid',
    )
    await page.locator('main').focus()
    await nothingOverContent()
  })
}

/**
 * Force CSS :hover on one element (no pointer events, so the collapsed rail stays collapsed).
 * The DevTools session must stay attached: detaching clears forced pseudo-classes.
 */
async function hoverForcer(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  return async (selector: string, on: boolean) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: on ? ['hover'] : [] })
  }
}

const STATES = {
  light: {
    idle: 'rgba(0, 0, 0, 0)',
    hover: 'rgb(226, 226, 220)', // #E2E2DC
    selected: 'rgb(211, 213, 204)', // #D3D5CC
    selectedHover: 'rgb(201, 205, 193)', // #C9CDC1
    hoverFg: 'rgb(36, 38, 34)', // #242622
    selectedFg: 'rgb(32, 37, 31)', // #20251F
  },
  // Dark keeps the shared surfaces: hover neutral.800, selected neutral.750.
  dark: {
    idle: 'rgba(0, 0, 0, 0)',
    hover: 'rgb(46, 47, 44)',
    selected: 'rgb(59, 59, 55)',
    selectedHover: 'rgb(59, 59, 55)',
    hoverFg: 'rgb(236, 236, 233)',
    selectedFg: 'rgb(236, 236, 233)',
  },
}

for (const theme of ['light', 'dark'] as const) {
  test(`sidebar row states: default, hover, selected, selected-hover and focus (${theme})`, async ({
    page,
  }) => {
    await fixture(page)
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard')
    const want = STATES[theme]
    const forceHover = await hoverForcer(page)
    const nav = rail(page).getByRole('navigation', { name: 'Main' })
    const home = nav.getByRole('link', { name: /^Home/ })
    const inbox = nav.getByRole('link', { name: /^Inbox/ })
    const style = (link: typeof home) =>
      link.evaluate((el) => {
        const cs = getComputedStyle(el)
        return {
          bg: cs.backgroundColor,
          color: cs.color,
          icon: getComputedStyle(el.querySelector('svg')!).color,
          weight: cs.fontWeight,
          bar: getComputedStyle(el, '::before').backgroundColor,
          transition: `${cs.transitionProperty} ${cs.transitionDuration}`,
        }
      })

    for (const size of ['collapsed', 'expanded'] as const) {
      if (size === 'expanded') {
        await inbox.focus()
        await rail(page).getByRole('button', { name: 'Pin sidebar' }).click()
        await page.locator('main').focus()
        await page.mouse.move(900, 450)
      }
      await expect(rail(page)).toHaveAttribute('data-expanded', String(size === 'expanded'))
      // Default (unselected) and selected.
      expect((await style(inbox)).bg, `${size} default`).toBe(want.idle)
      const selected = await style(home)
      expect(selected.bg, `${size} selected`).toBe(want.selected)
      expect(selected.color).toBe(want.selectedFg)
      expect(selected.icon).toBe(want.selectedFg)
      expect(selected.weight).toBe('600')
      expect(selected.bar).not.toBe('rgba(0, 0, 0, 0)')
      expect(selected.transition).toContain('0.15s')
      // Hover on an unselected row: its own step, visibly different from selected.
      await forceHover('aside nav a[href="/inbox"]', true)
      await expect.poll(async () => (await style(inbox)).bg).toBe(want.hover)
      const hovered = await style(inbox)
      expect(hovered.color).toBe(want.hoverFg)
      expect(hovered.icon).toBe(want.hoverFg)
      expect(hovered.bg).not.toBe(selected.bg)
      await forceHover('aside nav a[href="/inbox"]', false)
      // Selected + hover keeps the selected treatment (fill, weight, bar).
      await forceHover('aside nav a[href="/dashboard"]', true)
      await expect.poll(async () => (await style(home)).bg).toBe(want.selectedHover)
      expect((await style(home)).weight).toBe('600')
      expect((await style(home)).bar).toBe(selected.bar)
      await forceHover('aside nav a[href="/dashboard"]', false)
      // Keyboard focus: a separate solid ring, the fill unchanged.
      await inbox.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      expect(await page.locator(':focus').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
        'solid',
      )
      await page.locator('main').focus()
    }
    // Reduced motion removes the transition.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await style(inbox)).transition).toMatch(/^none /)
    await rail(page).getByRole('button', { name: 'Unpin sidebar' }).click()
  })
}

const LONG_WORKSPACE = 'Sri Lakshmi Narasimha Handloom Silk Sarees & Textiles Private Limited'
for (const scheme of ['light', 'dark'] as const) {
  test(`header layout: balanced search, sizes, long name and connection error (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await fixture(page, ['ERROR'], LONG_WORKSPACE)
    const header = page.getByRole('banner')
    const height = async (name: RegExp) =>
      Math.round((await header.getByRole('button', { name }).first().boundingBox())!.height)
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/dashboard')
      const workspace = header.getByRole('button', { name: /Current workspace/ })
      await expect(workspace).toHaveAccessibleName(
        `Current workspace: ${LONG_WORKSPACE}. Switch workspace`,
      )
      const control = header.getByRole('button', { name: /^WhatsApp: Error\./ })
      await expect(control).toHaveAttribute('data-health', 'disconnected')
      expect(Math.round((await header.boundingBox())!.height)).toBe(64)
      expect(await height(/^Appearance/)).toBe(36)
      expect(await height(/^Notifications/)).toBe(36)
      expect(await height(/Account menu/)).toBe(32)
      const search = header
        .getByRole('button', { name: 'Search and jump to (Control K)' })
        .locator('visible=true')
      await expect(search).toHaveCount(1)
      if (width === 1440) {
        await expect(control).toHaveText('Disconnected')
        const s = (await search.boundingBox())!
        const h = (await header.boundingBox())!
        expect(s.width).toBeGreaterThanOrEqual(360)
        expect(s.width).toBeLessThanOrEqual(440)
        expect(Math.round(s.height)).toBe(40)
        // Centred in the header (equal flexible sides).
        expect(Math.abs(s.x + s.width / 2 - (h.x + h.width / 2))).toBeLessThanOrEqual(2)
      } else {
        // Collapsed to an icon that opens the existing command palette.
        expect(Math.round((await search.boundingBox())!.width)).toBe(36)
        await search.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.keyboard.press('Escape')
      }
      // No overlaps between the header's groups; long names truncate instead of overflowing.
      const groups = await header.evaluate((el) =>
        [...el.querySelectorAll(':scope > *')]
          .map((child) => child.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => [r.left, r.right] as const),
      )
      for (let i = 1; i < groups.length; i++)
        expect(groups[i]![0]).toBeGreaterThanOrEqual(groups[i - 1]![1] - 0.5)
      const ws = (await workspace.boundingBox())!
      expect(ws.x + ws.width).toBeLessThanOrEqual((await control.boundingBox())!.x)
      await noOverflow(page)
    }
    // The shortcut still opens the palette, and the old divider is gone.
    await page.keyboard.press('Control+K')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await header.locator('span.w-px').count()).toBe(0)
  })
}
