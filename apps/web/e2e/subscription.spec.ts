import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

/** Phase 11 Step 4: the Subscription page (docs/BILLING.md → Plans). */
test.beforeEach(() => resetRateLimits())

test('shows the trial, limits and plans; the owner requests a plan', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-subscription')
  // Deterministic prices: the real plans (real ids, so requesting one works) with the price set
  // by the test, independent of any price an operator configured on this stack.
  let growthPrice: number | null = null
  await page.route('**/api/v1/billing/plans', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const plan of body.data)
      plan.price =
        plan.key === 'GROWTH' && growthPrice !== null
          ? { amountMinor: growthPrice, currency: 'INR', interval: 'MONTH' }
          : null
    await route.fulfill({ response, json: body })
  })
  await page.goto('/billing/subscription')
  await expect(page.getByRole('heading', { name: 'Subscription', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Trial · 1[34] days left$/ })).toBeVisible()

  const limits = page.getByRole('region', { name: 'Limits' })
  await expect(limits.getByText('Contacts', { exact: true })).toBeVisible()
  await expect(limits.getByText('Team members', { exact: true })).toBeVisible()

  // Plans are data; no price is invented (P11-D4).
  for (const name of ['Starter', 'Growth', 'Business'])
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible()
  await expect(page.getByText('Pricing: contact us')).toHaveCount(3)

  await page.getByRole('button', { name: 'Request Growth' }).click()
  await expect(page.getByText('Growth requested', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Requested' })).toBeDisabled()

  // A configured price is shown as money per month; the others still say contact us.
  growthPrice = 149_900
  await page.reload()
  await expect(page.getByText(/^₹1,499\.00 \/ month$/)).toBeVisible()
  await expect(page.getByText('Pricing: contact us')).toHaveCount(2)

  // Wallet stays a separate concept.
  await expect(page.getByRole('link', { name: 'View wallet' })).toHaveAttribute(
    'href',
    '/billing/wallet',
  )

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})
