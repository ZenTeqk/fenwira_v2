import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

/** Phase 11 Step 3: API keys and outbound webhooks (docs/API_KEYS.md, docs/WEBHOOKS.md). */

test.beforeEach(() => resetRateLimits())

test('create an API key, see the secret once, then revoke it', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-api-keys')
  await page.goto('/integrations/api')
  await expect(page.getByRole('heading', { name: 'API', level: 1 })).toBeVisible()
  await expect(page.getByText('No API keys yet')).toBeVisible()

  await page.getByRole('button', { name: 'Create API key' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Create API key' })
  await dialog.getByLabel('Name').fill('Lenz integration')
  await dialog.getByLabel('View contacts').check()
  await dialog.getByRole('button', { name: 'Create key' }).click()

  const secretDialog = page.getByRole('dialog', { name: 'API key created' })
  await expect(secretDialog.getByText('Copy this key now.')).toBeVisible()
  const secretText = await secretDialog.locator('code').innerText()
  expect(secretText).toMatch(/^fw_[A-Za-z0-9]{8}_/)
  await secretDialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText(secretText)).toHaveCount(0)

  const card = page.getByText('Lenz integration').locator('..')
  await expect(page.getByText(/fw_[a-z0-9]{8}_••••••/)).toBeVisible()
  await expect(page.getByText('Contacts: read')).toBeVisible()

  await page.getByRole('button', { name: 'Revoke' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByText('immediately stop authenticating')).toBeVisible()
  await confirm.getByRole('button', { name: 'Revoke key' }).click()
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible()
  void card
})

test('add a webhook endpoint, see the signing secret once, send a test delivery', async ({
  page,
}) => {
  await signInAsNewOwner(page, 'ui-webhooks')
  await page.goto('/integrations/webhooks')
  await expect(page.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible()
  await expect(page.getByText('No webhook endpoints yet')).toBeVisible()

  await page.getByRole('button', { name: 'Add endpoint' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add webhook endpoint' })
  await dialog.getByLabel('Name').fill('Production CRM')
  await dialog.getByLabel('Endpoint URL').fill('https://example.com/webhooks/fenwira')
  await dialog.getByRole('button', { name: 'Continue' }).click()

  await dialog.getByText('Contact created').click()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByText('HMAC-signed')).toBeVisible()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByText('1 selected')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create endpoint' }).click()

  const secretDialog = page.getByRole('dialog', { name: 'Webhook endpoint created' })
  await expect(secretDialog.getByText('Copy this signing secret now.')).toBeVisible()
  const secret = await secretDialog.locator('code').first().innerText()
  expect(secret).toMatch(/^whsec_/)
  await secretDialog.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByText('Production CRM')).toBeVisible()
  await page.getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByRole('heading', { name: 'Production CRM' })).toBeVisible()

  await page.getByRole('button', { name: 'Send test' }).click()
  await page.getByRole('tab', { name: 'Deliveries' }).click()
  await expect(page.getByText('Test', { exact: true })).toBeVisible({ timeout: 10_000 })
})
