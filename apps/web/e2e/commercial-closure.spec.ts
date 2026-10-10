import AxeBuilder from '@axe-core/playwright'
import { subscriptionSchema, workspaceStatusSchema } from '@fenwira/contracts'
import { chromium, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { signInAsNewOwner } from './support'

const run = promisify(execFile)
const routes = [
  '/billing/wallet',
  '/billing/subscription',
  '/analytics',
  '/analytics/messaging',
  '/analytics/campaigns',
  '/analytics/inbox',
  '/analytics/automations',
  '/analytics/usage',
  '/integrations/api',
  '/integrations/webhooks',
]
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('trial warnings and ended subscriptions keep billing navigation accessible', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signInAsNewOwner(page, 'closure-banners')
  // UI states are controlled response fixtures; actual expiry/cancellation is proved by integration.
  let state: { status: 'TRIALING' | 'EXPIRED' | 'CANCELLED'; days: number | null } = {
    status: 'TRIALING',
    days: 3,
  }
  const summary = () => ({
    status: state.status,
    trialDaysLeft: state.days,
    trialEndsAt: new Date(Date.now() + (state.days ?? -1) * 86_400_000).toISOString(),
  })
  await page.route('**/api/v1/workspace/status', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.data = workspaceStatusSchema.parse({ ...body.data, subscription: summary() })
    await route.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/billing/subscription', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.data = subscriptionSchema.parse({ ...body.data, ...summary(), plan: null })
    await route.fulfill({ response, json: body })
  })
  for (const width of [375, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const scenario of [
      { status: 'TRIALING', days: 3, title: 'Trial ends in 3 days' },
      { status: 'TRIALING', days: 1, title: 'Trial ends in 1 day' },
      { status: 'EXPIRED', days: null, title: 'Your trial has ended' },
      { status: 'CANCELLED', days: null, title: 'Your subscription has ended' },
    ] as const) {
      state = scenario
      await page.goto('/dashboard')
      const notice = page
        .getByRole(state.status === 'TRIALING' ? 'status' : 'alert')
        .filter({ hasText: scenario.title })
      await expect(notice.getByText(scenario.title, { exact: true })).toBeVisible()
      const link = notice.getByRole('link', { name: 'View subscription' })
      await expect(link).toHaveAttribute('href', '/billing/subscription')
      if (state.status !== 'TRIALING')
        await expect(notice).toContainText('Your data is kept and inbound messages keep arriving.')
      await link.focus()
      await expect(link).toBeFocused()
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([])
      await link.press('Enter')
      await expect(page).toHaveURL(/\/billing\/subscription$/)
      await expect(page.getByRole('heading', { name: 'Subscription', level: 1 })).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([])
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
    }
  }
})

test('Phase 11 commercial routes are responsive and WCAG 2.2 AA accessible', async ({ page }) => {
  test.setTimeout(process.env.CLOSURE_LIGHTHOUSE ? 600_000 : 180_000)
  await signInAsNewOwner(page, 'closure-ui')
  // Hold the response explicitly: verify the loading state instead of racing a fast API.
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const overview = /\/api\/v1\/analytics\/overview(?:\?|$)/
  await page.route(overview, async (route) => {
    await gate
    await route.continue()
  })
  try {
    await page.goto('/analytics')
    await expect(page.getByRole('status', { name: 'Loading analytics' })).toBeVisible()
    expect(
      (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id),
    ).toEqual([])
  } finally {
    release()
  }
  await expect(page.getByRole('status', { name: 'Loading analytics' })).toBeHidden()
  await page.unroute(overview)
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of routes) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `${path} at ${width}`,
      ).toBeLessThanOrEqual(1)
      const axe = await new AxeBuilder({ page }).withTags(tags).analyze()
      expect(
        axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`),
        `${path} at ${width}`,
      ).toEqual([])
      await page.screenshot({
        path: `test-results/closure-ui/${width}-${path.replaceAll('/', '-')}.png`,
        fullPage: true,
      })
    }
  }
  if (process.env.CLOSURE_LIGHTHOUSE === 'true') {
    const directory = resolve(__dirname, '../test-results/closure-lighthouse')
    mkdirSync(directory, { recursive: true })
    const profile = resolve(directory, 'chrome-profile')
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      args: ['--remote-debugging-port=9334', '--remote-debugging-address=127.0.0.1'],
    })
    const scores: Array<{ path: string; score: number; failing: string[] }> = []
    try {
      await context.addCookies(await page.context().cookies())
      for (const path of routes) {
        const output = resolve(directory, 'result.json')
        const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
        await run(
          'pnpm',
          [
            'dlx',
            'lighthouse@12.8.2',
            `${base}${path}`,
            '--port=9334',
            '--only-categories=accessibility',
            '--output=json',
            `--output-path=${output}`,
            '--quiet',
            '--disable-storage-reset',
          ],
          { cwd: resolve(__dirname, '../../..'), timeout: 60_000 },
        )
        const report = JSON.parse(readFileSync(output, 'utf8'))
        expect(new URL(report.finalDisplayedUrl).pathname).toBe(path)
        const score = report.categories.accessibility.score * 100
        const failing = Object.entries(report.audits)
          .filter(([, a]) => (a as { score: number | null }).score === 0)
          .map(([id]) => id)
        scores.push({ path, score, failing })
        expect(score, path).toBe(100)
      }
      writeFileSync(
        resolve(directory, 'scores.json'),
        `${JSON.stringify({ capturedAt: new Date().toISOString(), lighthouse: '12.8.2', category: 'accessibility', finalUrlsVerified: true, scores }, null, 2)}\n`,
      )
    } finally {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
      rmSync(resolve(directory, 'result.json'), { force: true })
    }
  }
})
