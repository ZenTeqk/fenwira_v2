import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { resetRateLimits, signInAsNewOwner } from './support'

/** Phase 11 Step 4: the Subscription page (docs/BILLING.md → Plans). */
test.beforeEach(() => resetRateLimits())

test('shows the trial, limits and plans; the owner requests a plan', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-subscription')
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
  await expect(page.getByText('Growth requested')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Requested' })).toBeDisabled()

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
