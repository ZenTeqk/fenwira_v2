import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

/**
 * Requires the local stack with the meta-mock profile and developer connect on
 * (COMPOSE_PROFILES=meta-mock, WHATSAPP_DEV_CONNECT=true,
 * META_GRAPH_BASE_URL=http://fenwira-meta-mock:4200 — see docs/DEPLOYMENT.md).
 */
const MOCK = process.env.E2E_META_MOCK_URL ?? 'http://127.0.0.1:4200'
const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)

test.beforeEach(() => resetRateLimits())

test('connect a number with developer connect, test it, and disconnect it', async ({ page }) => {
  const wabaId = metaId()
  const phoneNumberId = metaId()
  const seeded = await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      name: 'Acme WABA',
      phones: [{ id: phoneNumberId, display: '+1 555-010-4242', verifiedName: 'Acme Foods' }],
    }),
  })
  expect(seeded.ok).toBe(true)
  const token = `mock-dev:${wabaId}:e2e-token`

  await signInAsNewOwner(page, 'ui-whatsapp')
  await page.goto('/settings/whatsapp')
  await expect(page.getByText('No WhatsApp number connected')).toBeVisible()

  await page.getByRole('button', { name: 'Developer connect' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Developer connect' })
  await dialog.getByLabel('WhatsApp Business Account ID').fill(wabaId)
  await dialog.getByLabel('Phone number ID').fill(phoneNumberId)
  await dialog.getByLabel('Access token').fill(token)
  await dialog.getByRole('button', { name: 'Connect number' }).click()

  const card = page.getByRole('region', { name: 'WhatsApp number +1 555-010-4242' })
  await expect(card.getByText('Connected', { exact: true })).toBeVisible()
  await expect(card.getByText('High quality')).toBeVisible()
  await expect(card.getByText('Subscribed')).toBeVisible()
  await expect(card.getByText(/^mock….{4}$/)).toBeVisible()
  await expect(page.getByText(token)).toHaveCount(0)

  await card.getByRole('button', { name: 'Test connection' }).click()
  const testDialog = page.getByRole('dialog', { name: 'Test connection' })
  await testDialog.getByRole('button', { name: 'Run test' }).click()
  await expect(testDialog.getByText('Meta reached this number')).toBeVisible()
  await testDialog.getByRole('button', { name: 'Close' }).first().click()

  // The token never reaches browser storage.
  const stored = await page.evaluate(
    () =>
      JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie,
  )
  expect(stored).not.toContain('mock-dev:')

  // Also reachable from Integrations → WhatsApp.
  await page.goto('/integrations/whatsapp')
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: 'Manage +1 555-010-4242' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('No WhatsApp number connected')).toBeVisible()
})
