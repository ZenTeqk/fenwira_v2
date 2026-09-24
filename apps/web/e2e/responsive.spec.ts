import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'phone', width: 375, height: 812 },
]

for (const vp of VIEWPORTS) {
  for (const path of ['/dashboard', '/dev/ui']) {
    test(`${path} has no horizontal scroll at ${vp.width}px`, async ({ page }) => {
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
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/dashboard')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden()

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await expect(drawer.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})

test('sidebar collapses to an icon rail and remembers it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  const sidebar = page.locator('aside')
  const wide = await sidebar.evaluate((el) => el.getBoundingClientRect().width)
  expect(wide).toBe(248)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(64)
  await page.reload()
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(64)
  // Icon-only links keep an accessible name.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
})
