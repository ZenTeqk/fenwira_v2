import { expect, test } from '@playwright/test'

test('root redirects to the dashboard, which reports platform health', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByTestId('api-overall')).toContainText('All systems operational')
})
