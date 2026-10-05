import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { API, PASSWORD, signInAsNewOwner, totp } from './support'
import { provisionOperator } from './support-platform'

/** Manual funding through the shared MFA-authenticated operator CLI/domain boundary. */
async function topUp(browser: Browser, tenantId: string, rupees: number, reason: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  let operator: Awaited<ReturnType<typeof provisionOperator>> | undefined
  try {
    operator = await provisionOperator(page, 'wallet-operator')
    const login = await page.request.post(`${API}/platform/auth/login`, {
      data: { email: operator.email, password: PASSWORD },
    })
    expect(login.status()).toBe(200)
    const challengeToken = (await login.json()).data.challengeToken as string
    const verify = await page.request.post(`${API}/platform/auth/verify`, {
      data: { challengeToken, code: totp(operator.secret, 1) },
    })
    expect(verify.status()).toBe(200)
    const csrf = (await verify.json()).data.csrfToken as string
    const session = (await context.cookies()).find((c) => c.name === 'fw_platform')!.value
    const root = resolve(__dirname, '../../..')
    // Build the frozen CLI and dependencies; never restore the former database shortcut.
    execFileSync('pnpm', ['--filter', '@fenwira/worker...', 'build'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 90000,
    })
    const output = execFileSync(
      process.execPath,
      [
        'apps/worker/dist/cli/wallet-credit.js',
        '--tenant',
        tenantId,
        '--amount',
        String(rupees),
        '--reason',
        reason,
        '--reference',
        'wallet-browser-fixture',
        '--idempotency-key',
        randomUUID(),
      ],
      {
        cwd: root,
        stdio: 'pipe',
        timeout: 15000,
        env: {
          ...process.env,
          PLATFORM_API_URL: API,
          PLATFORM_SESSION_TOKEN: session,
          PLATFORM_CSRF_TOKEN: csrf,
        },
      },
    )
    expect(output.toString()).toMatch(/Recorded operation/)
  } finally {
    operator?.revoke()
    await context.close()
  }
}

test('Wallet: backend state, ledger, filters, CSV export, accessible', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const owner = await signInAsNewOwner(page, 'e2e-wallet')
  await topUp(browser, owner.tenantId, 250, 'E2E top-up')

  // Billing is reachable from the sidebar; it opens on Subscription (Phase 11 Step 4), and the
  // Wallet is its own tab — subscription and wallet are separate concepts.
  await page.goto('/dashboard')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Billing' })
    .click()
  await expect(page).toHaveURL(/\/billing\/subscription$/)
  await page
    .getByRole('navigation', { name: 'Billing pages' })
    .getByRole('link', { name: 'Wallet' })
    .click()
  await expect(page).toHaveURL(/\/billing\/wallet$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible()

  // The local stack doesn't enforce billing: the backend says NOT_ENFORCED and the UI shows it.
  await expect(page.getByText('Messages aren’t billed in this workspace')).toBeVisible()
  await expect(page.getByText('Not billed', { exact: true })).toBeVisible()
  await expect(page.getByText('₹250.00').first()).toBeVisible()

  const table = page.getByRole('table', { name: 'Wallet transactions' })
  await expect(table.getByRole('row', { name: /E2E top-up/ })).toContainText('+₹250.00')

  // Filters: no usage yet → the filtered-empty state; clearing brings the row back.
  await page.getByRole('combobox', { name: 'Type' }).click()
  await page.getByRole('option', { name: 'Usage' }).click()
  await expect(page.getByText('No matching transactions')).toBeVisible()
  await page.getByRole('button', { name: /Clear/ }).click()
  await expect(table.getByRole('row', { name: /E2E top-up/ })).toBeVisible()

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^wallet-transactions-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync((await file.path())!, 'utf8')
  expect(csv).toContain('E2E top-up')
  expect(csv).toContain(',250.00,250.00,INR,')

  await page.waitForLoadState('networkidle')
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])
})
