import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { customerWritesIn, resetRateLimits, signInAsNewOwner } from './support'

/**
 * AI Assistant (docs/AI_ASSISTANT.md) against the local stack with AI_PROVIDER=mock (the default):
 * knowledge upload → ready, test questions with sources and a clear no-answer, turning the
 * assistant on, and an AI-labelled reply to a (mock) WhatsApp customer.
 */
test.beforeEach(() => resetRateLimits())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    results.violations.map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target) })),
  ).toEqual([])
}

/**
 * Fixture: the operator switch, set directly as the database superuser (the operator console's
 * own flow needs a 2FA platform session and is covered by the API suite).
 */
function enableAi(tenantId: string) {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('bad tenant id')
  const sql = `INSERT INTO ai_settings (tenant_id, enabled, monthly_message_quota, business_name, handoff_message, updated_at)
    VALUES ('${tenantId}', true, 100, 'Anna Bakery', 'A teammate will reply soon.', now())
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, monthly_message_quota = 100`
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'fenwira-postgres', 'psql', '-U', 'postgres', '-d', 'fenwira', '-c', sql],
    { cwd: resolve(__dirname, '../../..') },
  )
}

const HOURS =
  'Anna Bakery is open on weekdays from 9am to 6pm. On Saturday the opening hours are 10am to 2pm.'

test('upload, test with sources, turn on, and a customer gets an AI reply', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'ui-ai')

  // Not enabled yet: the activation request page, no dead dashboard controls.
  await page.goto('/ai-assistant')
  await expect(page.getByRole('button', { name: 'Request activation' }).first()).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'AI Assistant sections' })).toHaveCount(0)
  enableAi(owner.tenantId)

  await page.goto('/ai-assistant')
  await expect(page.getByRole('heading', { name: 'AI Assistant', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'AI Assistant' }).first()).toBeVisible()
  await expectNoViolations(page)

  await page.getByRole('tab', { name: 'Knowledge' }).click()
  await expect(page.getByText('No knowledge yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled()
  await page.getByTestId('knowledge-file-input').setInputFiles({
    name: 'opening-hours.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(HOURS),
  })
  const sources = page.getByRole('list', { name: 'Knowledge sources' })
  await expect(sources.getByText('opening-hours')).toBeVisible()
  await expect(sources.getByText('Ready')).toBeVisible({ timeout: 30_000 })
  await expectNoViolations(page)

  await page.getByRole('tab', { name: 'Test' }).click()
  await page.getByLabel('Test question').fill('What are the opening hours on weekdays?')
  await page.getByRole('button', { name: 'Ask' }).click()
  const log = page.getByRole('log', { name: 'Test conversation' })
  await expect(log.getByText('Anna Bakery is open on weekdays from 9am to 6pm.', { exact: true })).toBeVisible()
  await log.getByText(/Sources used/).click()
  await expect(log.getByText('opening-hours', { exact: true })).toBeVisible()
  await page.getByLabel('Test question').fill('Do you repair bicycles?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(log.getByText('No answer found in your documents')).toBeVisible()
  await expectNoViolations(page)

  await page.getByRole('tab', { name: 'Overview' }).click()
  await page.getByRole('button', { name: 'Turn on AI Assistant' }).click()
  await expect(page.getByText('AI Assistant is on.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit in Automations' })).toBeVisible()
  // Sonner's fading toasts trip axe colour-contrast; audit once they've gone.
  await expect(page.getByText('AI Assistant is on.')).toBeHidden({ timeout: 15_000 })
  await expectNoViolations(page)

  const customer = await customerWritesIn(page, owner, 'What are the opening hours on weekdays?')
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  const thread = page.getByRole('log', { name: 'Messages' })
  await expect(thread.getByText('Anna Bakery is open on weekdays from 9am to 6pm.', { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(thread.getByText('AI', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Conversation state' }).getByText('AI handling')).toBeVisible()
})
