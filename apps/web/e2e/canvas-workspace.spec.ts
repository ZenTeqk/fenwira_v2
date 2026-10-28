import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockCanvas } from './canvas-fixture'

for (const width of [1440, 390])
  test(`full-screen canvas and accessible outline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mockCanvas(page)
    await page.goto('/automations/canvas-fixture/edit')
    await expect(page.getByRole('heading', { name: 'Welcome flow', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Fenwira home' })).toHaveCount(0)
    expect(await page.locator('main').evaluate((el) => el.clientHeight)).toBe(1000)
    if (width === 390) {
      await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
      await expect(page.getByText('Editing is best on a larger screen')).toBeVisible()
      await expect(page.locator('.react-flow__node.draggable')).toHaveCount(0)
      await page.getByTestId('flow-node-message').click()
      await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('readonly', '')
      await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: 'Outline', exact: true }).click()
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  })

test('add, edit, autosave, publish and protect unsaved Back navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const state = await mockCanvas(page)
  await page.goto('/automations/canvas-fixture/edit')
  await page
    .getByRole('navigation', { name: 'Add a step' })
    .getByRole('button', { name: 'Send message', exact: true })
    .click()
  await page.getByLabel('Message', { exact: true }).fill('A new draft message')
  await expect(page.getByRole('button', { name: 'Saving...', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  expect(state.graph.nodes.some((node) => node.config.text === 'A new draft message')).toBe(true)
  await page.getByRole('button', { name: 'Delete step Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByRole('button', { name: 'Publish automation', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your automation is live' })).toBeVisible()
  expect(state.publishes).toBe(1)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  state.failSave = true
  await page.getByTestId('flow-node-message').click()
  await page.getByLabel('Message', { exact: true }).fill('Unsaved message')
  await expect(
    page.getByRole('button', { name: "Couldn't save, retry", exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Back to Automations' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Leave with unsaved changes?' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL(/\/edit$/)
})
