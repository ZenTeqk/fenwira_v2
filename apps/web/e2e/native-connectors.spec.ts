import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'
import type { NativeConnectorCatalog, NativeConnection } from '@fenwira/contracts'
test.beforeEach(() => resetRateLimits())
test('native app grid: honest configuration, protected setup, confirmations and responsive controls', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  await signInAsNewOwner(page, 'native-grid')
  const providers = ['ERPNEXT', 'GOOGLE_SHEETS', 'ZOHO_CRM', 'SHOPIFY'] as const
  const catalog: NativeConnectorCatalog[] = providers.map((provider) => ({
    provider,
    available: provider === 'ERPNEXT',
    connections: [],
  }))
  await page.route('**/api/v1/native-connectors', (route) =>
    route.fulfill({ json: { data: catalog } }),
  )
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/integrations')
    await expect(page.getByRole('heading', { name: 'Connected applications' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Connect Google Sheets', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Connect Zoho CRM', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Connect Shopify', exact: true })).toBeDisabled()
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`native-grid-${width}.png`), fullPage: true })
  }
  const connection: NativeConnection = {
    id: crypto.randomUUID(),
    provider: 'ERPNEXT',
    label: 'Textile ERP',
    site: 'https://erp.example.com',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  }
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/v1/native-connectors/connect', (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>
    catalog[0]!.connections = [connection]
    return route.fulfill({ json: { data: { connection } } })
  })
  await page.getByRole('button', { name: 'Connect ERPNext', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Connection name', { exact: true }).fill('Textile ERP')
  await page.getByLabel('ERPNext site URL', { exact: true }).fill('https://erp.example.com')
  await page.getByLabel('API key', { exact: true }).fill('browser-fixture-key')
  await page.getByLabel('API secret', { exact: true }).fill('browser-fixture-secret')
  await page.getByRole('button', { name: 'Verify and connect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Textile ERP', exact: true })).toBeVisible()
  expect(submitted?.apiSecret).toBe('browser-fixture-secret')
  await expect(page.getByText('browser-fixture-secret', { exact: true })).toHaveCount(0)
  await page.route(`**/api/v1/native-connectors/${connection.id}/transfers`, (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.getByRole('button', { name: 'Textile ERP', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare contact import', exact: true }).click()
  await expect(page.getByText(/Existing consent and suppression are preserved/)).toBeVisible()
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByText(/Revoke access or uninstall/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
})
test('OAuth callback clears codes from history and rejects workspace/state mismatch', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'native-callback')
  await page.goto('/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible()
  let calls = 0
  await page.route('**/api/v1/native-connectors/oauth/complete', (route) => {
    calls++
    return route.fulfill({ json: { data: { id: crypto.randomUUID() } } })
  })
  await page.evaluate(
    ({ tenantId }) =>
      sessionStorage.setItem(
        'fenwira.native.authorization',
        JSON.stringify({ tenantId, state: 'a'.repeat(43) }),
      ),
    owner,
  )
  await page.goto(`/integrations/native/callback?state=${'a'.repeat(43)}&code=private-code`)
  await expect(
    page.getByText('Application connected. Return to Integrations to start a contact transfer.'),
  ).toBeVisible()
  expect(page.url()).not.toContain('private-code')
  expect(calls).toBe(1)
  await page.goto(`/integrations/native/callback?state=${'b'.repeat(43)}&code=private-code`)
  await expect(
    page.getByText(/Authorization could not be completed in this workspace/),
  ).toBeVisible()
  expect(calls).toBe(1)
})
