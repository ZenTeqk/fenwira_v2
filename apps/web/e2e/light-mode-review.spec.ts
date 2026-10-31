import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { seedInbox, seedReviewInbox } from './inbox-fixtures'

// Light-mode review (shared shell, Home, Inbox). Records come from the domain APIs through the
// existing fixtures; LIGHT_SHOTS_DIR saves review screenshots (docs/design/.../light-mode-*/).
const shots = process.env.LIGHT_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const shot = async (page: Page, name: string, fullPage = false) => {
  if (shots)
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage, animations: 'disabled' })
}
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
const noPageOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)

test('light mode: shell, Home and Inbox at desktop and narrow widths', async ({ page }) => {
  test.setTimeout(180_000)
  const { conversation } = await seedInbox(page)

  // Home
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Priya Sharma').first()).toBeVisible()
    await noPageOverflow(page)
    if (width === 1440 || width === 375) await axe(page)
    await shot(page, `home-${width}`, true)
  }

  // Inbox: list + thread + customer panel, then panel closed
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/inbox?c=${conversation.id}`)
  await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close contact details' })).toBeVisible()
  // While the panel is open the header has no separate open-details control.
  await expect(page.getByRole('button', { name: 'Show contact details' })).toHaveCount(0)
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'inbox-1440-panel-open')
  await page.getByRole('button', { name: 'Close contact details' }).click()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeVisible()
  await shot(page, 'inbox-1440-panel-closed')
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('button', { name: 'Close contact details' })).toBeVisible()

  // Internal note mode
  await page.getByRole('tab', { name: 'Internal note' }).click()
  await expect(page.getByRole('textbox', { name: 'Internal note' })).toBeVisible()
  await shot(page, 'inbox-1440-note-mode')
  await page.getByRole('tab', { name: 'Reply' }).click()

  // Conversation-list hover and keyboard focus
  const rows = page.getByRole('list', { name: 'Conversation list' }).getByRole('button')
  if ((await rows.count()) > 2) {
    await rows.nth(2).hover()
    await rows.nth(1).focus()
    await shot(page, 'inbox-1440-list-states')
  }

  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `inbox-${width}`)
  }
  await axe(page)

  // Shared-shell spot check on another module
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/contacts')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await axe(page)
  await shot(page, 'contacts-1440')
})

test('light mode: closed window, failed send, template and long messages', async ({ page }) => {
  test.setTimeout(120_000)
  const { conversation } = await seedReviewInbox(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/inbox?c=${conversation.id}`)
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Failed', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Reply window closed' })).toBeVisible()
  await axe(page)
  await shot(page, 'inbox-1440-failed-closed-window')
  await page.setViewportSize({ width: 375, height: 812 })
  await shot(page, 'inbox-375-failed-closed-window')
})
