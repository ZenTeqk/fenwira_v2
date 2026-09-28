import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { signInAsNewOwner } from './support'

/** Manual top-up through the operator CLI (decision B2/P11-D13), inside the worker container. */
function topUp(tenantId: string, rupees: number, reason: string) {
  execFileSync('docker', [
    'compose',
    'exec',
    '-T',
    'fenwira-worker',
    'node',
    'apps/worker/dist/cli/wallet-credit.js',
    '--tenant',
    tenantId,
    '--amount',
    String(rupees),
    '--reason',
    reason,
  ])
}

test('Wallet: backend state, ledger, filters, CSV export, accessible', async ({ page }) => {
  test.setTimeout(60_000)
  const owner = await signInAsNewOwner(page, 'e2e-wallet')
  topUp(owner.tenantId, 250, 'E2E top-up')

  // Billing is reachable from the sidebar (Phase 11 step 1 ships the Wallet page).
  await page.goto('/dashboard')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Billing' }).click()
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
