import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { customerWritesIn, resetRateLimits, signInAsNewOwner } from './support'

test.beforeEach(() => resetRateLimits())

const axe = async (page: Page) =>
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])

/**
 * Phase 8 in the browser: build a template with a variable, see the live preview and validation,
 * submit it (the simulated Meta approves it after a few seconds), then send it from the inbox
 * template picker.
 */
test('build → validate → submit → approved → sent from the inbox picker', async ({ page }) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'ui-templates')
  const customer = await customerWritesIn(page, owner, 'When does my order arrive?')

  await page.goto('/templates')
  await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible()
  // Connecting the number imported Meta's hello_world.
  await expect(page.getByRole('link', { name: 'hello_world' })).toBeVisible({ timeout: 15_000 })
  await axe(page)

  await page.getByRole('link', { name: 'Create template' }).click()
  const editor = page.getByRole('form', { name: 'Template editor' })
  await editor.getByLabel('Name').fill('Order Arrival')
  await expect(editor.getByLabel('Name')).toHaveValue('order_arrival')
  await editor.getByRole('textbox', { name: 'Message text' }).fill('Hi ')
  await editor.getByRole('button', { name: 'Variable', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Message text' }).press('End')
  await editor.getByRole('textbox', { name: 'Message text' }).type(', your order arrives on ')
  await editor.getByRole('button', { name: 'Variable', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Message text' }).press('End')
  await editor
    .getByRole('textbox', { name: 'Message text' })
    .type('. Thank you for shopping with us!')
  await expect(editor.getByRole('textbox', { name: 'Message text' })).toHaveValue(
    'Hi {{1}}, your order arrives on {{2}}. Thank you for shopping with us!',
  )
  // Same shared validation as the API: samples are required before submitting.
  await expect(page.getByText('Add a sample value for {{1}}.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
  await editor.getByLabel('Message {{1}}').fill('Asha')
  await editor.getByLabel('Message {{2}}').fill('Friday')
  const preview = page.getByRole('figure', { name: 'Message preview' })
  await expect(preview).toContainText('Hi Asha, your order arrives on Friday.')
  await expect(
    page.getByRole('region', { name: 'Message preview', exact: true }).last(),
  ).toBeVisible()
  await expect(preview.locator('[title="{{1}}"]')).toHaveCount(0)
  const originalBody = await editor.getByRole('textbox', { name: 'Message text' }).inputValue()
  await editor
    .getByRole('textbox', { name: 'Message text' })
    .fill(`${originalBody}\n*Order update* _Thank you_ ~Old date~`)
  await expect(preview.locator('strong')).toHaveText('Order update')
  await expect(preview.locator('em')).toHaveText('Thank you')
  await expect(preview.locator('s')).toHaveText('Old date')
  await editor.getByLabel('Message {{1}}').fill('<img src=x onerror=alert(1)>')
  await expect(preview).toContainText('<img src=x onerror=alert(1)>')
  await expect(preview.locator('img')).toHaveCount(0)
  await editor.getByLabel('Message {{1}}').fill('Asha')
  await editor.getByRole('textbox', { name: 'Message text' }).fill(originalBody)
  await axe(page)

  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Meta is reviewing this template')).toBeVisible()
  // The simulated review approves it; the page polls while PENDING.
  await expect(page.locator('[data-status="APPROVED"]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: 'Version history' }).click()
  await expect(page.getByRole('table', { name: 'Versions' })).toContainText('v1')
  await axe(page)

  // Send it from the inbox.
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  await page.getByRole('button', { name: 'Send a template' }).click()
  const picker = page.getByRole('dialog', { name: 'Send a template' })
  await picker.getByRole('combobox').click()
  await page.getByRole('option', { name: /order_arrival/ }).click()
  await expect(picker.getByRole('button', { name: 'Send template' })).toBeDisabled()
  await picker.getByLabel('Message {{1}}').fill('Ravi')
  await picker.getByLabel('Message {{2}}').fill('Monday')
  await expect(picker.getByRole('figure', { name: 'Message preview' })).toContainText(
    'Hi Ravi, your order arrives on Monday.',
  )
  await axe(page)
  await picker.getByRole('button', { name: 'Send template' }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByRole('log', { name: 'Messages' }).getByText('order_arrival')).toBeVisible()
})
