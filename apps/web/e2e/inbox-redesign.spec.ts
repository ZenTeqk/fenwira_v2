import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { join } from 'node:path'
import { seedInbox, seedReviewInbox } from './inbox-fixtures'

/** Set INBOX_SHOTS_DIR to keep review screenshots outside the repo. */
const shots = process.env.INBOX_SHOTS_DIR
const box = async (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const { x, y, width, height } = el.getBoundingClientRect()
    return { x, y, width, height }
  }, selector)

const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations

test('connected inbox layout: column sizes, compact header and strip, collapsible panel', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const { conversation } = await seedInbox(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/inbox?c=${conversation.id}`)
  const messages = page.getByRole('log', { name: 'Messages' })
  await expect(
    messages.getByText('Interested in the 55-inch model. Confirm stock before following up.'),
  ).toBeVisible()
  const panel = page.getByRole('complementary', { name: 'Contact details' })
  await expect(panel).toBeVisible()
  await expect(page.getByRole('group', { name: 'Conversation state' })).toContainText('Window open')

  // 1440: rail + list + chat + inline details, no gaps between columns.
  const rail = await box(page, 'aside:has(nav[aria-label="Main"])')
  const list = await box(page, 'section[aria-label="Conversations"]')
  const chat = await box(page, 'section[aria-label="Conversation"]')
  const details = await box(page, 'aside[aria-labelledby$="-title"]')
  expect(rail?.width).toBe(64)
  expect(list?.width).toBe(319) // 320px column less its 1px divider
  expect(list!.x).toBe(64)
  expect(chat!.x).toBe(64 + 320)
  expect(details?.width).toBe(312)
  expect(chat!.x + chat!.width).toBe(details!.x)
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Conversation"] > *')].map(
        (el) => el.getBoundingClientRect().height,
      ),
    ),
  ).toEqual(expect.arrayContaining([80, 44]))
  expect(await axe(page)).toEqual([])

  // Closing the panel widens the chat and keeps the draft; the choice is remembered.
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('Keep this draft while the panel closes')
  await panel.getByRole('button', { name: 'Close contact details' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()
  expect((await box(page, 'section[aria-label="Conversation"]'))!.width).toBe(1440 - 64 - 320)
  await expect(reply).toHaveValue('Keep this draft while the panel closes')
  await page.reload()
  await expect(messages).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Contact details' })).toBeHidden()
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('complementary', { name: 'Contact details' })).toBeVisible()

  // 1200: list + chat; details open as an overlay.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole('complementary', { name: 'Contact details' })).toBeHidden()
  expect((await box(page, 'section[aria-label="Conversations"]'))?.width).toBe(299)
  await page.getByRole('button', { name: 'Show contact details' }).click()
  const overlay = page.getByRole('dialog', { name: 'Contact details' })
  await expect(overlay).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()
})

test('review scenario renders real data at 1440 and 1200', async ({ page }) => {
  test.setTimeout(180_000)
  const { conversation } = await seedReviewInbox(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/inbox?c=${conversation.id}`)
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Failed', { exact: true })).toBeVisible()
  await expect(
    log.getByRole('group', { name: /The 55-inch model is available/ }).first(),
  ).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Reply window closed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose template' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Conversation state' })).toContainText(
    'Automation paused',
  )
  await expect(page.getByRole('list', { name: 'Conversation list' })).toContainText('3 unread')
  // A failed message never shows ticks.
  const failedRow = log
    .getByText('Failed', { exact: true })
    .locator('xpath=ancestor::div[@data-message-id]')
  await expect(failedRow.getByRole('img', { name: /Sent|Delivered|Read|Sending/ })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-1440.png') })
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole('complementary', { name: 'Contact details' })).toBeHidden()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-1200.png') })
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('dialog', { name: 'Contact details' })).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, 'inbox-1200-details.png') })
})
