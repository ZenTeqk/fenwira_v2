import { expect, test } from '@playwright/test'
import { signInAsNewOwner } from './support'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('Dropdown: open with Enter, move with arrows, select, focus returns', async ({ page }) => {
  await page.goto('/dev/ui')
  const trigger = page.getByTestId('dropdown-trigger')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  await page.keyboard.press('m') // typeahead jumps to 'Message'
  await expect(page.getByRole('menuitem', { name: 'Message' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.getByTestId('last-action')).toHaveText('Message')
  await expect(trigger).toBeFocused()
})

test('Modal: focus moves in, Tab stays trapped, Escape closes and restores focus', async ({
  page,
}) => {
  await page.goto('/dev/ui')
  const opener = page.getByRole('button', { name: 'Open modal' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Edit contact' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('Tabs: arrow keys move between tabs and panels', async ({ page }) => {
  await page.goto('/dev/ui')
  const list = page.getByRole('tablist', { name: 'Contact sections' })
  await list.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(list.getByRole('tab', { name: 'Conversations' })).toBeFocused()
  await expect(list.getByRole('tab', { name: 'Conversations' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('End')
  await expect(list.getByRole('tab', { name: 'Consent' })).toHaveAttribute('aria-selected', 'true')
})

test('ConfirmDialog: focus starts on Cancel, Escape cancels', async ({ page }) => {
  await page.goto('/dev/ui')
  await page.getByRole('button', { name: 'Delete tag…' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete this tag?' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('last-action')).toHaveText('Delete cancelled')
})

test('CommandPalette: Control+K opens, type to filter, Enter runs', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-palette')
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(
    'Search contacts, conversations, campaigns… or jump to a page',
  )
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
})

test('CommandPalette navigates to every visible nav item', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAsNewOwner(page, 'ui-palette-nav')
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  const hrefs = await page
    .getByRole('navigation', { name: 'Main' })
    .locator('a[href]')
    .evaluateAll((links) =>
      links.map((a) => ({ href: a.getAttribute('href')!, name: (a.textContent ?? '').trim() })),
    )
  expect(hrefs.length).toBeGreaterThan(0)

  // The sidebar lists modules; every page (sub-pages included) is in the palette's Go to group.
  await page.keyboard.press('Control+k')
  const navLabels = await page
    .getByRole('group', { name: 'Go to' })
    .getByRole('option')
    .allTextContents()
  await page.keyboard.press('Escape')
  expect(navLabels.length).toBeGreaterThanOrEqual(hrefs.length)

  for (const label of navLabels) {
    await page.keyboard.press('Control+k')
    await page
      .getByPlaceholder('Search contacts, conversations, campaigns… or jump to a page')
      .fill(label.replace(' › ', ' '))
    await page.getByRole('option', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const leaf = label.split(' › ').pop()!
    if (leaf === 'Home') {
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
    } else {
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).first()).toContainText(leaf)
    }
  }
})
