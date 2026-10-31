import { expect, test } from '@playwright/test'
import { applyReviewTheme, applyWebUpstream, signInAsNewOwner } from './support'

// REVIEW_THEME=dark runs these checks on the dark tokens.
test.beforeEach(async ({ context }) => {
  await applyWebUpstream(context)
  await applyReviewTheme(context)
})

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'phone', width: 375, height: 812 },
]

for (const vp of VIEWPORTS) {
  for (const path of [
    '/dashboard',
    '/dev/ui',
    '/integrations/api',
    '/integrations/webhooks',
    '/billing/subscription',
  ]) {
    test(`${path} has no horizontal scroll at ${vp.width}px`, async ({ page }) => {
      if (path !== '/dev/ui')
        await signInAsNewOwner(page, `ui-rwd-${path.replace(/\W/g, '')}-${vp.width}`)
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }
}

test('sidebar is persistent at 1024px and a drawer at 375px', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-rwd-drawer')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/dashboard')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden()

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await expect(drawer.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
})

test('sidebar starts as an icon rail and remembers the explicit pin preference', async ({
  page,
}) => {
  await signInAsNewOwner(page, 'ui-rwd-rail')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  const sidebar = page.getByRole('complementary', { name: 'Application navigation' })
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(68)
  await sidebar.getByRole('link', { name: 'Home', exact: true }).focus()
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click()
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-pinned', 'true')
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(232)
  await page.getByRole('button', { name: 'Unpin sidebar' }).click()
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
  await page.mouse.move(500, 20)
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(68)
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-pinned', 'false')
  await expect(sidebar.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
})
