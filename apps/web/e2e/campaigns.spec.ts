import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { API, metaId, MOCK, ownerHeaders, resetRateLimits, signInAsNewOwner } from './support'

test.beforeEach(() => resetRateLimits())

const axe = async (page: Page) =>
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])

/**
 * Phase 9 in the browser: create → review → launch → delivery/status reporting. The simulated
 * Meta approves the imported template and reports sent → delivered → read for each message.
 */
test('create a campaign, review it, launch it and watch the results', async ({ page }) => {
  test.setTimeout(120_000)
  const owner = await signInAsNewOwner(page, 'ui-campaigns')
  const h = ownerHeaders(owner)
  // A connected number with an approved utility template, and two tagged contacts.
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  await fetch(`${MOCK}/__mock/templates`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      add: [
        {
          name: 'delivery_notice',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}, your delivery is on its way today.',
              example: { body_text: [['Asha']] },
            },
          ],
        },
      ],
    }),
  })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers: h,
  })
  expect(connected.status()).toBe(201)
  expect(
    (await page.request.post(`${API}/templates/sync`, { data: {}, headers: h })).status(),
  ).toBe(200)
  const tag = await page.request.post(`${API}/tags`, {
    data: { name: `Wave ${metaId().slice(-4)}`, color: 'PRIMARY' },
    headers: h,
  })
  const tagId = (await tag.json()).data.id
  for (const name of ['Asha Rao', 'Ravi Kumar'])
    expect(
      (
        await page.request.post(`${API}/contacts`, {
          data: { phone: `+9194${String(Math.random()).slice(2, 10)}`, name, tagIds: [tagId] },
          headers: h,
        })
      ).status(),
    ).toBe(201)

  await page.goto('/campaigns')
  await expect(page.getByRole('heading', { name: 'Campaigns', level: 1 })).toBeVisible()
  await axe(page)
  await page.getByRole('link', { name: 'Create campaign' }).click()

  // 1. Audience
  await page.getByLabel('Campaign name').fill('Delivery wave')
  await page.getByRole('checkbox', { name: /Wave/ }).first().click()
  await axe(page)
  await page.getByRole('button', { name: 'Save and continue' }).click()
  // 2. Template (the only live number is preselected)
  await page.getByRole('combobox', { name: 'Approved template' }).click()
  await page.getByRole('option', { name: /delivery_notice/ }).click()
  await expect(page.getByRole('figure', { name: 'Message preview' })).toContainText(
    'your delivery is on its way',
  )
  await page.getByRole('button', { name: 'Save and continue' }).click()
  // 3. Variables: {{1}} = first name
  await page.getByRole('combobox', { name: 'Message {{1}}: value' }).click()
  await page.getByRole('option', { name: 'First name' }).click()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  // 4. Schedule: now
  await expect(page.getByRole('radio', { name: /Send now/ })).toBeChecked()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  // 5. Review: the server estimate with rendered samples
  await expect(page.getByText('Will receive it')).toBeVisible()
  const review = page.getByRole('main')
  await expect(review.getByRole('figure', { name: 'Message preview' }).first()).toContainText(
    /Hi (Asha|Ravi), your delivery/,
  )
  await axe(page)
  await page.getByRole('button', { name: 'Launch campaign' }).click()
  // High-impact action: the confirmation states who receives it and the estimated cost.
  const launchDialog = page.getByRole('alertdialog', { name: 'Launch this campaign now?' })
  await expect(launchDialog.getByRole('list', { name: 'What will happen' })).toContainText(
    'contacts receive',
  )
  await launchDialog.getByRole('button', { name: 'Launch campaign' }).click()

  // Detail: live status and results from the delivery webhooks.
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-status="COMPLETED"]').first()).toBeVisible({ timeout: 60_000 })
  const results = page.getByRole('region', { name: 'Campaign results' })
  const readCard = results.locator('[data-slot="metric-card"]').filter({ hasText: /^Read/ })
  await expect(readCard).toContainText('2', { timeout: 30_000 })
  await expect(page.getByRole('table', { name: 'Recipients' })).toContainText('Asha Rao')
  await expect(page.getByText('Delivery rate')).toBeVisible()
  await axe(page)

  // Home uses the same cumulative domain counters: read messages are already included in sent.
  await page.goto('/dashboard')
  await expect(page.getByText('2 / 2 sent', { exact: true })).toBeVisible()
  const homeProgress = page.getByRole('progressbar', { name: 'Campaign messages sent' })
  await expect(homeProgress).toHaveAttribute('value', '2')
  await expect(homeProgress).toHaveAttribute('max', '2')
  await axe(page)

  await page.goto('/campaigns/analytics')
  await expect(page.getByRole('table', { name: 'Campaign results' })).toContainText('Delivery wave')
  await axe(page)
})
