import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, signInAsNewOwner, totp } from './support'
import { provisionOperator } from './support-platform'

/**
 * ADR-0027 manual UPI billing, real local stack (no mocks): the operator issues a wallet top-up,
 * the owner pays by UPI and submits the UTR, the operator approves it in the payment queue, and
 * the owner sees it paid with a receipt. Needs UPI_VPA and UPI_PAYEE_NAME on the API (the stack is
 * started with them; see docs/MANAGED_LAUNCH.md → Local checks). Skipped otherwise.
 */
test.skip(
  !process.env.E2E_UPI_VPA,
  'start the stack with UPI_VPA/UPI_PAYEE_NAME and set E2E_UPI_VPA',
)

async function axe(page: Page) {
  await page.waitForLoadState('networkidle')
  // Sonner fades stacked toasts (axe reads that as low contrast): audit once they are gone.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  )
}

test('operator invoices, owner pays by UPI and submits the UTR, operator approves', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const operator = await provisionOperator(page, 'payments-real')
  const ownerContext = await browser.newContext()
  const utr = String(Date.now()).slice(-12)
  try {
    const ownerPage = await ownerContext.newPage()
    const owner = await signInAsNewOwner(ownerPage, 'payments-owner')

    // Operator: sign in with MFA and issue a ₹250 wallet top-up.
    await page.goto('/platform/login')
    await page.getByLabel('Email').fill(operator.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Authenticator code').fill(totp(operator.secret, 1))
    await page.getByRole('button', { name: 'Verify and enter platform' }).click()
    await expect(page).toHaveURL(/\/platform\/workspaces$/)
    await page.goto(`/platform/workspaces/${owner.tenantId}`)
    await page.getByRole('button', { name: 'Create invoice' }).click()
    const create = page.getByRole('dialog', { name: 'Create invoice' })
    await create.getByLabel('Type').click()
    await page.getByRole('option', { name: 'Wallet top-up' }).click()
    await create.getByLabel('Amount before tax (₹)').fill('250')
    await create.getByRole('button', { name: 'Create invoice' }).click()
    await expect(create).toHaveCount(0)
    await expect(page.getByRole('cell', { name: /^FW-INV-\d{6}$/ })).toBeVisible()

    // Owner: Billing → Invoices shows the QR and deep link; submit the UTR.
    await ownerPage.goto('/billing/invoices')
    await expect(ownerPage.getByText('Meta charges are billed separately')).toBeVisible()
    await ownerPage.getByRole('button', { name: /FW-INV-\d{6}/ }).click()
    const drawer = ownerPage.getByRole('dialog', { name: /Invoice FW-INV-/ })
    await expect(drawer.getByRole('img', { name: /UPI QR code to pay ₹250.00/ })).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'Open in UPI app' })).toHaveAttribute(
      'href',
      /^upi:\/\/pay\?pa=.+&am=250\.00&cu=INR&tn=FW-INV-\d{6}$/,
    )
    await axe(ownerPage)
    await drawer.getByLabel('UTR / UPI reference number').fill(utr)
    await drawer.getByRole('button', { name: 'Submit payment' }).click()
    await expect(drawer.getByText("We're verifying your payment")).toBeVisible()

    // Operator: the payment queue → approve against the bank statement.
    await page.goto('/platform/payments')
    const row = page.getByRole('row', { name: new RegExp(utr) })
    await expect(row).toBeVisible()
    await axe(page)
    await row.getByRole('button', { name: /^Approve FW-INV-/ }).click()
    const review = page.getByRole('dialog', { name: 'Approve payment' })
    await review.getByLabel('Bank statement reference').fill('E2E bank statement line')
    await review.getByRole('button', { name: 'Approve payment' }).click()
    await expect(page.getByText(/Approved · receipt FW-RCT-\d{6}/)).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(utr) })).toHaveCount(0)

    // Owner: paid, with a receipt.
    await ownerPage.reload()
    const paid = ownerPage.getByRole('dialog', { name: /Invoice FW-INV-/ })
    await expect(paid.getByText('Paid', { exact: true })).toBeVisible()
    const download = ownerPage.waitForEvent('download')
    await paid.getByRole('button', { name: 'Receipt' }).click()
    expect((await download).suggestedFilename()).toMatch(/^FW-RCT-\d{6}\.html$/)
    for (const width of [375, 1440]) {
      await ownerPage.setViewportSize({ width, height: 900 })
      expect(
        await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true)
    }
  } finally {
    await ownerContext.close()
    operator.revoke()
  }
})
