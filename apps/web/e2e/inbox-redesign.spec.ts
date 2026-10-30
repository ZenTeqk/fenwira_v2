import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { join } from 'node:path'
import { seedInbox, seedReviewInbox } from './inbox-fixtures'
import { API } from './support'

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
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  await expect(panel).toBeVisible()
  await expect(page.getByRole('group', { name: 'Conversation state' })).toContainText(
    'Reply window',
  )

  // 1440: original application sidebar + 320px list + flexible chat + 320px details.
  const rail = await box(page, 'aside:has(nav[aria-label="Main"])')
  const list = await box(page, 'section[aria-label="Conversations"]')
  const chat = await box(page, 'section[aria-label="Conversation"]')
  const details = await box(page, 'aside[aria-labelledby$="-title"]')
  expect([224, 64]).toContain(rail?.width)
  expect(list?.width).toBe(319) // 320px column less its 1px divider
  expect(list!.x).toBe(rail!.width)
  expect(chat!.x).toBe(rail!.width + 320)
  expect(details?.width).toBe(320)
  expect(chat!.x + chat!.width).toBe(details!.x)
  await expect(page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })).toBeVisible()
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Conversation"] > *')].map(
        (el) => el.getBoundingClientRect().height,
      ),
    ),
  ).toEqual(expect.arrayContaining([72]))
  expect(await axe(page)).toEqual([])

  // Closing the panel widens the chat and keeps the draft; the choice is remembered.
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('Keep this draft while the panel closes')
  await panel.getByRole('button', { name: 'Close contact details' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()
  expect((await box(page, 'section[aria-label="Conversation"]'))!.width).toBe(
    1440 - rail!.width - 320,
  )
  await expect(reply).toHaveValue('Keep this draft while the panel closes')
  await page.reload()
  await expect(messages).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Customer details' })).toBeHidden()
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('complementary', { name: 'Customer details' })).toBeVisible()

  // 1200: list + chat; reopening details docks them beside the conversation.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole('complementary', { name: 'Customer details' })).toBeHidden()
  expect((await box(page, 'section[aria-label="Conversations"]'))?.width).toBe(299)
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(panel).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Contact details' })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  await panel.getByRole('button', { name: 'Close contact details' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()

  // 900: compact list and chat side by side, no horizontal scroll.
  await page.setViewportSize({ width: 900, height: 900 })
  expect((await box(page, 'section[aria-label="Conversations"]'))?.width).toBe(279)
  await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
})

test('drafts survive switching conversations; closing the panel keeps draft and scroll', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const { conversation } = await seedInbox(page)
  await page.setViewportSize({ width: 1440, height: 640 })
  await page.goto(`/inbox?c=${conversation.id}`)
  const log = page.getByRole('log', { name: 'Messages' })
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('Draft for Priya')
  await page.getByRole('tab', { name: 'Internal note' }).click()
  await page.getByLabel('Internal note', { exact: true }).fill('Note draft')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await list.getByText('Kumar Stores').click()
  await expect(log.getByText('Please share your catalogue.')).toBeVisible()
  await expect(reply).toHaveValue('')
  await reply.fill('Draft for Kumar')
  await list.getByText('Priya Sharma').click()
  await expect(reply).toHaveValue('Draft for Priya')
  await page.getByRole('tab', { name: 'Internal note' }).click()
  await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue('Note draft')
  await page.getByRole('tab', { name: 'Reply' }).click()
  await page.reload()
  await expect(reply).toHaveValue('Draft for Priya')

  // Scroll to the start, then close the panel: no jump, draft intact.
  const first = log.getByText('Do you have the 55-inch model? Can you share the price?')
  await log.evaluate((el) => (el.scrollTop = 0))
  await expect(first).toBeInViewport()
  await page
    .getByRole('complementary', { name: 'Customer details' })
    .getByRole('button', { name: 'Close contact details' })
    .click()
  await expect(first).toBeInViewport()
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(reply).toHaveValue('Draft for Priya')
})

test('contact panel: add and remove a tag, add a note', async ({ page }) => {
  test.setTimeout(120_000)
  const { conversation, headers } = await seedInbox(page)
  const vip = await page.request.post(`${API}/tags`, {
    headers: await headers(),
    data: { name: 'VIP', color: 'WARNING' },
  })
  expect(vip.status(), await vip.text()).toBe(201)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/inbox?c=${conversation.id}`)
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const tags = panel.getByRole('region', { name: 'Tags' })
  await expect(tags).toContainText('Television')
  await tags.getByRole('button', { name: 'Remove tag Television' }).click()
  await expect(tags).not.toContainText('Television')
  await tags.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('menuitem', { name: 'VIP' }).click()
  await expect(tags).toContainText('VIP')

  const notes = panel.getByRole('region', { name: 'Contact notes' })
  await notes.getByRole('button', { name: 'Add note' }).click()
  await notes.getByLabel('New contact note').fill('Prefers a call after 6 pm.')
  await notes.getByRole('button', { name: 'Save note' }).click()
  await expect(notes).toContainText('Prefers a call after 6 pm.')

  // Eligibility and automation expand on demand.
  const eligibility = panel.getByRole('button', { name: 'Messaging eligibility' })
  await expect(eligibility).toHaveAttribute('aria-expanded', 'false')
  await eligibility.click()
  await expect(panel.getByRole('link', { name: 'View eligibility and consent' })).toBeVisible()
  expect(await axe(page)).toEqual([])
})

test('390px: one view at a time, back navigation, composer stays visible', async ({ page }) => {
  test.setTimeout(120_000)
  await seedInbox(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inbox')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await list.getByText('Priya Sharma').click()
  await expect(list).toBeHidden()
  const reply = page.getByLabel('Reply', { exact: true })
  await expect(reply).toBeInViewport()
  // The on-screen keyboard takes about 40% of the height: the composer stays on screen.
  await reply.focus()
  await page.setViewportSize({ width: 390, height: 500 })
  await expect(reply).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-390.png') })

  await page.getByRole('button', { name: 'Show contact details' }).click()
  const details = page.getByRole('dialog', { name: 'Contact details' })
  await expect(details).toBeVisible()
  expect((await details.boundingBox())?.width).toBe(390)
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(reply).toBeVisible()
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(list).toBeVisible()
  await expect(page.getByRole('log', { name: 'Messages' })).toHaveCount(0)
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

  // Chips above the timeline: Templates and Notes, each with Jump to message.
  await page.getByRole('button', { name: 'Filter conversation messages' }).click()
  const chips = page.getByRole('group', { name: 'Show messages' })
  const chip = (label: string) => chips.getByRole('button', { name: new RegExp(`^${label} `) })
  await expect(chip('Templates')).toHaveText('Templates 2')
  await expect(chip('Audio')).toHaveText('Audio 0')
  await expect(chip('Notes')).toHaveText('Notes 1')
  await chip('Templates').click()
  await expect(chip('Templates')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: /The 55-inch model is available/ })).toHaveCount(2)
  await chip('Audio').click()
  await expect(page.getByText('No audio in this conversation')).toBeVisible()
  await chip('Notes').click()
  await expect(page.getByText('Asked about delivery to Nagercoil.')).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.getByRole('button', { name: 'Jump to message' }).click()
  await expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-note-id]')).toBeFocused()
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole('complementary', { name: 'Customer details' })).toBeHidden()
  expect(await axe(page)).toEqual([])
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('complementary', { name: 'Customer details' })).toBeVisible()
})
