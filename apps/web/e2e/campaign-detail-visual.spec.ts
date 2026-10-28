import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PASSWORD, resetRateLimits } from './support'

/** Read-only, opt-in review of the persisted synthetic textile workspace. */
test('campaign detail explains results and remains accessible across screen sizes', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.EV2_CAMPAIGN_DETAIL_REVIEW !== 'true',
    'Requires the local textile demo fixture',
  )
  test.setTimeout(120_000)
  const fixture = JSON.parse(
    readFileSync(
      resolve('../../docs/design/experience-v2/evidence/textile-campaign-demo/textile-demo.json'),
      'utf8',
    ),
  ) as {
    email: string
    campaigns: { id: string; name: string; status: string }[]
  }
  await resetRateLimits()
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(fixture.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  const completed = fixture.campaigns.find((c) => c.name === 'Handloom Bedsheet Collection')!
  await page.goto(`/campaigns/${completed.id}`)
  await expect(page.getByRole('heading', { name: completed.name, level: 1 })).toBeVisible()
  const progress = page.getByRole('progressbar', { name: 'Sent reach of eligible audience' })
  await expect(progress).toHaveAttribute('value', '8')
  await expect(progress).toHaveAttribute('max', '8')
  await expect(page.getByRole('region', { name: 'Campaign milestones' })).toContainText(
    'Campaign completed',
  )
  await expect(
    page.getByRole('region', { name: 'Message preview', exact: true }).last(),
  ).toBeVisible()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations
    expect(violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`completed-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const statusFilter = page.getByRole('combobox', { name: 'Status', exact: true })
  await statusFilter.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(statusFilter).toBeFocused()
  const scheduled = fixture.campaigns.find((c) => c.status === 'SCHEDULED')!
  await page.goto(`/campaigns/${scheduled.id}`)
  await expect(
    page.getByText('Results appear after the audience is prepared.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('progressbar', { name: 'Sent reach of eligible audience' }),
  ).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('scheduled-1440.png'), fullPage: true })
  for (const [status, title] of [
    ['PAUSED_INSUFFICIENT_FUNDS', 'Paused: not enough credits'],
    ['PAUSED_TEMPLATE_UNAVAILABLE', 'Paused: the template is unavailable'],
    ['FAILED', 'The campaign stopped'],
  ]) {
    const campaign = fixture.campaigns.find((c) => c.status === status)!
    await page.goto(`/campaigns/${campaign.id}`)
    await expect(page.getByText(title, { exact: true })).toBeVisible()
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await page.screenshot({
      path: testInfo.outputPath(`${status.toLowerCase()}-1440.png`),
      fullPage: true,
    })
  }
  await page.route(`**/api/v1/campaigns/${completed.id}/stats`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporarily unavailable' } }),
    }),
  )
  await page.goto(`/campaigns/${completed.id}`)
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('progressbar', { name: 'Sent reach of eligible audience' }),
  ).toHaveCount(0)
})
