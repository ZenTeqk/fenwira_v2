import { expect, test } from '@playwright/test'
import { signInAsNewOwner } from './support'

test('signed-out visitors land on sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('signed-in owners see the dashboard with platform health', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-smoke')
  await page.goto('/')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByTestId('api-overall')).toContainText('All systems operational')
})
