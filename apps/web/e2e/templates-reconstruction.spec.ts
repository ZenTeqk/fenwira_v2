import AxeBuilder from '@axe-core/playwright'
import { chromium, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  API,
  customerWritesIn,
  ownerHeaders,
  signInAsNewOwner,
  uniqueEmail,
  linkFromEmail,
  PASSWORD,
} from './support'
test('Templates read-only members see message context without write/sync actions', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'templates-reader')
  await customerWritesIn(page, owner, 'Synthetic read-only template fixture')
  const email = uniqueEmail('templates-viewer'),
    since = Date.now()
  expect(
    (
      await page.request.post(`${API}/team/invitations`, {
        headers: ownerHeaders(owner),
        data: { email, role: 'VIEWER' },
      })
    ).status(),
  ).toBe(201)
  const token = (await linkFromEmail(email, '/invitations/', since)).split('/invitations/')[1]
  const context = await browser.newContext()
  try {
    const viewer = await context.newPage()
    expect(
      (
        await viewer.request.post(`${API}/invitations/${token}/accept`, {
          data: { name: 'Reader', password: PASSWORD },
        })
      ).status(),
    ).toBe(200)
    await viewer.setViewportSize({ width: 1440, height: 1000 })
    await viewer.goto('/templates')
    await expect(viewer.getByRole('link', { name: 'Hello world', exact: true })).toBeVisible()
    await expect(viewer.getByRole('link', { name: 'Create template', exact: true })).toHaveCount(0)
    await expect(
      viewer.getByRole('button', { name: 'Sync with WhatsApp', exact: true }),
    ).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Preview hello_world', exact: true }).click()
    const panel = viewer.getByRole('dialog', { name: 'hello_world', exact: true })
    await expect(panel.getByRole('figure', { name: 'Message preview' })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Use in campaign', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('link', { name: 'Open editor', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('link', { name: 'Open template', exact: true })).toBeVisible()
    expect(
      (
        await new AxeBuilder({ page: viewer })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  } finally {
    await context.close()
  }
})

test('Templates sending-option failure is explicit and retry restores authoritative availability', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'templates-options-error')
  await customerWritesIn(page, owner, 'Synthetic sending-options fixture')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/v1/templates/approved', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Sending options unavailable' },
      }),
    }),
  )
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Preview hello_world', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'hello_world', exact: true })
  await expect(panel.getByRole('alert')).toContainText('Sending options couldn’t be loaded')
  await expect(panel.getByRole('link', { name: 'Use in campaign', exact: true })).toHaveCount(0)
  await page.unroute('**/api/v1/templates/approved')
  await panel.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(panel.getByRole('link', { name: 'Use in campaign', exact: true })).toBeVisible()
})

test('Templates library meets the Lighthouse accessibility gate', async ({ page }) => {
  test.skip(
    process.env.EV2_TEMPLATES_LIGHTHOUSE !== 'true',
    'Set EV2_TEMPLATES_LIGHTHOUSE=true for the explicit audit',
  )
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'templates-lighthouse')
  await customerWritesIn(page, owner, 'Synthetic template-library audit fixture')
  const directory = resolve(__dirname, '../test-results/templates-lighthouse')
  mkdirSync(directory, { recursive: true })
  const profile = resolve(directory, 'chrome-profile')
  const output = resolve(directory, 'result.json')
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--remote-debugging-port=9337', '--remote-debugging-address=127.0.0.1'],
  })
  try {
    await context.addCookies(await page.context().cookies())
    const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
    await promisify(execFile)(
      'pnpm',
      [
        'dlx',
        'lighthouse@12.8.2',
        `${base}/templates`,
        '--port=9337',
        '--only-categories=accessibility',
        '--output=json',
        `--output-path=${output}`,
        '--quiet',
        '--disable-storage-reset',
      ],
      { cwd: resolve(__dirname, '../../..'), timeout: 60_000 },
    )
    const report = JSON.parse(readFileSync(output, 'utf8'))
    expect(new URL(report.finalDisplayedUrl).pathname).toBe('/templates')
    const score = report.categories.accessibility.score * 100
    const failing = Object.entries(report.audits)
      .filter(([, audit]) => (audit as { score: number | null }).score === 0)
      .map(([id]) => id)
    expect(score).toBeGreaterThanOrEqual(95)
    expect(failing).toEqual([])
    writeFileSync(
      resolve(directory, 'scores.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          lighthouse: '12.8.2',
          category: 'accessibility',
          finalUrlsVerified: true,
          scores: [{ path: '/templates', score, failing }],
        },
        null,
        2,
      ),
    )
  } finally {
    await context.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(output, { force: true })
  }
})
