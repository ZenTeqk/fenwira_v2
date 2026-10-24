import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { API, PASSWORD, signInAsNewOwner, totp } from './support'
import { provisionOperator } from './support-platform'
const runLighthouse = promisify(execFile)

/** Local-stack integration: verified global identity + existing MFA APIs + restricted grant CLI. */
test('real platform MFA, membership-free discovery, confirmed funding and revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(process.env.PLATFORM_LIGHTHOUSE ? 300000 : 120000)
  const operator = await provisionOperator(page, 'platform-real')
  const { email, secret } = operator
  const root = resolve(__dirname, '../../..')
  const customerContext = await browser.newContext()
  try {
    const customerPage = await customerContext.newPage()
    const customer = await signInAsNewOwner(customerPage, 'platform-customer')
    await page.goto('/platform/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Authenticator code').fill(totp(secret, 1))
    await page.getByRole('button', { name: 'Verify and enter platform' }).click()
    await expect(page).toHaveURL(/\/platform\/workspaces$/)
    // Repeated runs preserve history; select the exact workspace rather than a reused fixture name.
    await page.getByRole('searchbox', { name: 'Search workspaces' }).fill(customer.tenantId)
    await page.getByRole('link', { name: customer.workspaceName, exact: true }).click()
    await expect(page.getByText('Trial', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Start billing adjustment' }).click()
    await page.getByLabel('Amount (INR)').fill('1.23')
    await page.getByLabel('Reason').fill('Approved local funding fixture')
    await page.getByLabel('Support / funding reference').fill('browser-test-funding')
    await page.getByRole('button', { name: 'Preview impact' }).click()
    await page.getByRole('button', { name: 'Review and confirm' }).click()
    await page.getByRole('button', { name: 'Record commercial operation' }).click()
    await expect(page.getByRole('dialog', { name: 'Commercial operation recorded' })).toBeVisible()
    await expect(page.getByRole('dialog').getByText('INR 1.23', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: `test-results/platform-commercial-${width}.png`,
        fullPage: true,
      })
    }
    const auth = (await (await page.request.get(`${API}/auth/me`)).json()).data
    expect(auth.memberships).toHaveLength(0)
    if (process.env.PLATFORM_LIGHTHOUSE === 'true') {
      const directory = resolve(__dirname, '../test-results/platform-lighthouse')
      mkdirSync(directory, { recursive: true })
      const profile = resolve(directory, 'chrome-profile')
      const auditContext = await chromium.launchPersistentContext(profile, {
        headless: true,
        args: ['--remote-debugging-port=9333', '--remote-debugging-address=127.0.0.1'],
      })
      try {
        await auditContext.addCookies(await page.context().cookies())
        const scores: Array<{ path: string; score: number; failing: string[] }> = []
        for (const path of [
          '/platform/login',
          '/platform/workspaces',
          '/platform/billing-operations',
          '/platform/audit',
          `/platform/workspaces/${customer.tenantId}`,
        ]) {
          const output = resolve(directory, 'result.json')
          const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
          await runLighthouse(
            'pnpm',
            [
              'dlx',
              'lighthouse@12.8.2',
              `${base}${path}`,
              '--port=9333',
              '--only-categories=accessibility',
              '--disable-storage-reset',
              '--output=json',
              `--output-path=${output}`,
              '--quiet',
            ],
            { cwd: root, timeout: 60000 },
          )
          const report = JSON.parse(readFileSync(output, 'utf8')) as {
            finalDisplayedUrl: string
            categories: { accessibility: { score: number } }
            audits: Record<string, { score: number | null; title: string }>
          }
          expect(new URL(report.finalDisplayedUrl).pathname).toBe(path)
          const score = report.categories.accessibility.score * 100
          scores.push({
            path,
            score,
            failing: Object.entries(report.audits)
              .filter(([, a]) => a.score === 0)
              .map(([key]) => key),
          })
          expect(score, path).toBeGreaterThanOrEqual(95)
        }
        writeFileSync(resolve(directory, 'scores.json'), JSON.stringify(scores, null, 2))
      } finally {
        await auditContext.close()
        rmSync(profile, { recursive: true, force: true })
        rmSync(resolve(directory, 'result.json'), { force: true })
      }
    }
    operator.revoke()
    await page.reload()
    await expect(page).toHaveURL(/\/platform\/login$/)
  } finally {
    operator.revoke()
    await customerContext.close()
  }
})
