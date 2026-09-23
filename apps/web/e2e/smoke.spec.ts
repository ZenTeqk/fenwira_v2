import { expect, test } from '@playwright/test'

test('status page shows the API as operational', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Fenwira' })).toBeVisible()
  await expect(page.getByTestId('api-overall')).toContainText('Operational')
})
