import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { API, customerWritesIn, ownerHeaders, resetRateLimits, signInAsNewOwner } from './support'

/** Phase 10 builder (docs/prompts/PHASE_10_AUTOMATION.md): canvas, outline, publish, history. */
test.beforeEach(() => resetRateLimits())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 5).map((n) => n.target),
    })),
  ).toEqual([])
}

test('build a keyword flow on the canvas, publish, and the customer gets the reply', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'ui-auto')
  await page.goto('/automations')
  await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible()
  await expectNoViolations(page)
  await page.getByRole('link', { name: 'Create automation' }).first().click()
  await page.getByTestId('template-scratch').first().click()
  await expect(page.getByRole('heading', { name: 'Untitled automation', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('dialog', { name: 'Automation settings' })
    .getByLabel('Name')
    .fill('Pricing reply')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('heading', { name: 'Pricing reply', level: 1 })).toBeVisible()

  const palette = page.getByRole('navigation', { name: 'Add a step' })
  await palette.getByRole('button', { name: 'Keyword', exact: true }).click()
  await page.getByLabel('Keywords').fill('pricing, prices')
  await palette.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  await page.getByRole('tab', { name: 'Ready to publish', exact: true }).click()
  // Live validation: the empty message is flagged before publishing.
  await expect(page.getByText(/things? to fix first/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()
  await page.getByLabel('Message', { exact: true }).fill('Our plans start at ₹99, ')
  await page.getByRole('combobox', { name: 'Insert a value into Message' }).click()
  await page.getByRole('option', { name: 'First name' }).click()
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Our plans start at ₹99, {{contact.firstName}}',
  )
  await palette.getByRole('button', { name: 'End', exact: true }).click()
  await expect(page.getByText('Yes. Every step is set up and connected.')).toBeVisible()
  await expect(page.getByTestId(/^flow-node-/)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await expectNoViolations(page)

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Publish this automation?' })
    .getByRole('button', { name: 'Publish automation', exact: true })
    .click()
  await expect(page.getByText('Published. New conversations use this version.')).toBeVisible()
  const live = page.getByRole('dialog', { name: 'Your automation is live' })
  await expect(live).toContainText('When a message is “pricing” or “prices”')
  await live.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('[data-status=ACTIVE]')).toContainText('Live')

  const customer = await customerWritesIn(page, owner, 'Pricing')
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText(/Our plans start at ₹99, Customer/),
  ).toBeVisible({ timeout: 20_000 })

  // History: the run, its steps and the path on the pinned version.
  const flows = await page.request.get(`${API}/flows`, { headers: ownerHeaders(owner) })
  const flowId = ((await flows.json()) as { data: Array<{ id: string }> }).data[0]!.id
  await page.goto(`/automations/${flowId}/history`)
  await page.getByRole('link', { name: customer }).click()
  await expect(page.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText('Completed').first()).toBeVisible()
  await page.getByRole('button', { name: 'Show on canvas' }).click()
  await expect(page.getByTestId(/^flow-node-/)).toHaveCount(3)
  await expectNoViolations(page)
})

test('the outline builds and connects a flow with the keyboard only', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'ui-auto-kbd')
  const created = await page.request.post(`${API}/flows`, {
    data: { name: 'Keyboard flow' },
    headers: ownerHeaders(owner),
  })
  const id = ((await created.json()) as { data: { id: string } }).data.id
  await page.goto(`/automations/${id}`)
  const outlineTab = page.getByRole('tab', { name: 'Outline' })
  await page.getByRole('tab', { name: 'Canvas' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(outlineTab).toHaveAttribute('aria-selected', 'true')

  const choose = async (combobox: string, option: string) => {
    await page.getByRole('combobox', { name: combobox }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('option', { name: option, exact: true }).focus()
    await page.keyboard.press('Enter')
  }
  await choose('Add a trigger', 'Keyword')
  await page.getByLabel('Keywords').focus()
  await page.keyboard.type('menu')
  await choose('Add a step after Step 1: Keyword', 'Wait')
  await choose('Add a step after Step 2: Wait', 'End')
  const steps = page.getByRole('list', { name: 'Flow steps' }).getByRole('listitem')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(1)).toContainText('Step 2: Wait')
  await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  await page.getByRole('tab', { name: 'Ready to publish', exact: true }).click()
  await expect(page.getByText('Yes. Every step is set up and connected.')).toBeVisible()
  // Re-wire with a select: disconnect the wait → end edge, then the validator flags it.
  await choose('Next (Step 2: Wait)', 'Not connected')
  await expect(page.getByText(/things? to fix first/)).toBeVisible()
  await expectNoViolations(page)
})
