import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { PASSWORD, signInAsNewOwner, totp } from './support'
import { provisionOperator } from './support-platform'

const SHOTS = process.env.AI_ACTIVATION_SHOTS

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations).toEqual([])
}

for (const width of [1440, 390])
  test(`AI Assistant request page explains the product and passes axe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await signInAsNewOwner(page, `ai-page-${width}`)
    await page.goto('/ai-assistant')
    await expect(
      page.getByRole('heading', {
        name: 'Answer WhatsApp customers instantly, from your own documents',
      }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request activation' }).first()).toBeEnabled()
    for (const heading of ['What you get', 'How it works', 'Features', 'Pricing', 'Questions'])
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
    await expect(page.getByRole('figure', { name: 'Example test conversation' })).toBeVisible()
    // The FAQ is a native disclosure: keyboard opens it.
    const question = page.getByText('What happens when the monthly AI replies run out?')
    await question.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/hands every new conversation to your team/)).toBeVisible()
    await page.getByRole('link', { name: 'See how it works' }).click()
    await expect(page).toHaveURL(/#how-it-works$/)
    await expectNoViolations(page)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ai-activation-${width}.png`, fullPage: true })
  })

test('request activation, see Requested, operator approves, page becomes the dashboard', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'ai-request-flow')
  await page.goto('/ai-assistant')
  await page.getByRole('button', { name: 'Request activation' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Request AI Assistant' })
  await expect(dialog.getByLabel('Contact email')).toHaveValue(owner.email)
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(dialog.getByText('Enter a number of conversations.')).toBeVisible()
  if (await dialog.getByRole('combobox', { name: 'Plan' }).count()) {
    await dialog.getByRole('combobox', { name: 'Plan' }).click()
    await page.getByRole('option').first().click()
  }
  await dialog.getByLabel('Customer conversations per month').fill('250')
  await dialog
    .getByLabel('What should the assistant help with?')
    .fill('Delivery times, prices and opening hours')
  await dialog.getByLabel('Contact phone').fill('+91 98765 43210')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  const status = page.getByRole('status', { name: 'Activation request' })
  await expect(status.getByRole('heading', { name: 'Request received' })).toBeVisible()
  await expect(status.getByText('Requested', { exact: true })).toBeVisible()
  await expect(status.getByRole('button', { name: 'Cancel request' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request activation' }).first()).toBeDisabled()
  await expectNoViolations(page)

  const context = await browser.newContext()
  const console = await context.newPage()
  const operator = await provisionOperator(console, 'ai-operator')
  try {
    await console.setViewportSize({ width: 1440, height: 1000 })
    await console.goto('/platform/login')
    await console.getByLabel('Email').fill(operator.email)
    await console.getByLabel('Password').fill(PASSWORD)
    await console.getByRole('button', { name: 'Continue', exact: true }).click()
    await console.getByLabel('Authenticator code').fill(totp(operator.secret, 1))
    await console.getByRole('button', { name: 'Verify and enter platform' }).click()
    await expect(console).toHaveURL(/\/platform\/workspaces$/)
    await console.getByRole('link', { name: /^AI requests/ }).click()
    const row = console.getByRole('row').filter({ hasText: owner.email })
    await expect(row).toContainText('Delivery times, prices and opening hours')
    await row.getByRole('button', { name: 'Approve' }).click()
    const approve = console.getByRole('dialog', { name: `Approve ${owner.workspaceName}?` })
    if (await approve.getByLabel('Monthly AI replies').count())
      await approve.getByLabel('Monthly AI replies').fill('150')
    await approve.getByLabel('Note (optional)').fill('Welcome to AI Assistant')
    await approve.getByRole('button', { name: 'Approve and turn on' }).click()
    await expect(approve).toBeHidden()
    await expect(row).toHaveCount(0)
  } finally {
    await context.close()
    operator.revoke()
  }

  // No deploy: the same route now renders the dashboard, driven by the operator switch.
  await page.reload()
  await expect(page.getByRole('tablist', { name: 'AI Assistant sections' })).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: 'Answer WhatsApp customers instantly, from your own documents',
    }),
  ).toHaveCount(0)
})
