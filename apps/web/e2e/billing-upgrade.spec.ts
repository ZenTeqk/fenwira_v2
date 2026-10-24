import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { signInAsNewOwner } from './support'

/**
 * Upgrade now (Managed Launch): a trial owner opens Billing, chooses a plan and immediately sees
 * the invoice with a scannable UPI QR, the copyable UPI link and the UTR form. Needs the stack in
 * Managed Launch Mode with UPI_VPA/UPI_PAYEE_NAME (docs/MANAGED_LAUNCH.md → Local checks).
 */
test.skip(
  !process.env.E2E_UPI_VPA,
  'start the stack with MANAGED_LAUNCH_MODE=true, UPI_VPA/UPI_PAYEE_NAME and set E2E_UPI_VPA',
)

async function axe(page: Page) {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  )
}

test('trial owner chooses a plan and gets the UPI QR at once', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAsNewOwner(page, 'upgrade-owner')
  await page.goto('/billing')
  await expect(page).toHaveURL(/\/billing\/invoices$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Free trial · \d+ days? left/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No invoices yet' })).toBeVisible()
  await axe(page)

  await page.getByRole('button', { name: 'Upgrade' }).click()
  await page.getByRole('button', { name: 'Choose Growth' }).click()

  const pay = page.locator('#pay-now')
  await expect(pay.getByRole('heading', { name: 'Pay now' })).toBeVisible()
  const qr = pay.getByRole('img', { name: /UPI QR code to pay .* for FW-INV-\d{6}/ })
  await expect(qr).toBeVisible()
  const box = await qr.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(240)
  await expect(pay.getByRole('button', { name: 'Copy UPI link' })).toBeVisible()
  await expect(pay.getByLabel('UTR / UPI reference number')).toBeVisible()
  await expect(page.getByRole('cell', { name: /^FW-INV-\d{6}$/ })).toBeVisible()
  await expect(
    page.getByText(/Growth plan, 1 month from payment confirmation/).first(),
  ).toBeVisible()

  // Mobile: the QR and the form still fit without horizontal scrolling.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(qr).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
  await axe(page)
})
