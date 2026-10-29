import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { replyPreset, type FlowVersion } from '@fenwira/contracts'
import { mkdirSync } from 'node:fs'
import {
  API,
  ownerHeaders,
  refreshCsrf,
  resetRateLimits,
  signInAsNewOwner,
  type Owner,
} from './support'
async function seed(page: Page, owner: Owner, name: string, preset: 'keyword' | 'product-enquiry') {
  await refreshCsrf(page, owner)
  const r = await page.request.post(`${API}/flows`, {
    headers: ownerHeaders(owner),
    data: { name, managedBy: 'REPLY_STUDIO' },
  })
  expect(r.status()).toBe(201)
  const id = (await r.json()).data.id as string
  const version = (
    await (
      await page.request.get(`${API}/flows/${id}/draft`, { headers: ownerHeaders(owner) })
    ).json()
  ).data as FlowVersion
  expect(
    (
      await page.request.put(`${API}/flows/${id}/draft`, {
        headers: { ...ownerHeaders(owner), 'If-Match': version.etag },
        data: { graph: replyPreset(preset) },
      })
    ).status(),
  ).toBe(200)
  return id
}
async function quality(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([])
    if (process.env.REPLY_EXPERIENCE_SCREENSHOTS) {
      mkdirSync(process.env.REPLY_EXPERIENCE_SCREENSHOTS, { recursive: true })
      await page.screenshot({
        path: `${process.env.REPLY_EXPERIENCE_SCREENSHOTS}/${name}-${width}.png`,
        fullPage: false,
      })
    }
  }
}
test.beforeEach(() => resetRateLimits())
test('compact overview and empty, populated and filtered states preserve managed drafts', async ({
  page,
}) => {
  test.setTimeout(180000)
  const owner = await signInAsNewOwner(page, 'reply-experience')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations')
  await expect(page).toHaveURL(/\/automations\/workflows$/)
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
  await quality(page, 'overview')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/reply-studio')
  await expect(page).toHaveURL(/\/auto-replies$/)
  await expect(page.getByRole('heading', { name: 'Create your first auto reply' })).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create auto reply', exact: true })).toBeVisible()
  for (const card of await page
    .getByRole('region', { name: 'Starter flows' })
    .getByRole('article')
    .all())
    await expect(card).toBeInViewport({ ratio: 1 })
  await quality(page, 'empty')
  await page.getByRole('link', { name: 'Bot Flows', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your first bot flow' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create bot flow', exact: true })).toBeVisible()
  await seed(page, owner, 'Price reply draft', 'keyword')
  await seed(page, owner, 'Enquiry bot draft', 'product-enquiry')
  await page.goto('/automations/reply-studio/auto-replies')
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Enquiry bot draft', exact: true })).toHaveCount(0)
  const starters = page.getByRole('button', { name: 'Starter conversations', exact: true })
  await expect(starters).toHaveAttribute('aria-expanded', 'false')
  await starters.click()
  await page.reload()
  await expect(starters).toHaveAttribute('aria-expanded', 'true')
  await starters.click()
  await page.reload()
  await expect(starters).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('searchbox', { name: 'Search replies and flows' }).fill('unmatched')
  await expect(page.getByText('No results match your filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toBeVisible()
  await quality(page, 'populated')
  await page.getByRole('link', { name: 'Bot Flows', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Enquiry bot draft', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Price reply draft', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Auto Replies', exact: true }).click()
  const row = page.getByRole('article', { name: 'Price reply draft', exact: true })
  await row.getByRole('button', { name: 'Did this run?', exact: true }).click()
  const activity = page.getByRole('dialog', { name: 'Recent activity', exact: true })
  await expect(activity.getByText('No runs yet', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await row.getByRole('button', { name: 'Actions for Price reply draft' }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Archive automation', exact: true })
    .click()
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: 'Archived items', exact: true }).click()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Actions for Price reply draft' }).click()
  await page.getByRole('menuitem', { name: 'Restore', exact: true }).click()
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to current items', exact: true }).click()
  await expect(row).toBeVisible()
})

test('auto reply editor explains dry runs, discards drafts, and failures select their canvas node', async ({
  page,
}) => {
  test.setTimeout(180000)
  const owner = await signInAsNewOwner(page, 'reply-editor')
  const id = await seed(page, owner, 'Price rule', 'keyword')
  await refreshCsrf(page, owner)
  const draft = (
    await (
      await page.request.get(`${API}/flows/${id}/draft`, { headers: ownerHeaders(owner) })
    ).json()
  ).data as FlowVersion
  const graph = draft.graph
  graph.nodes.find((n) => n.type === 'trigger.keyword')!.config = {
    keywords: ['price'],
    match: 'WHOLE_WORD',
    caseSensitive: false,
  }
  expect(
    (
      await page.request.put(`${API}/flows/${id}/draft`, {
        headers: { ...ownerHeaders(owner), 'If-Match': draft.etag },
        data: { graph },
      })
    ).status(),
  ).toBe(200)
  expect(
    (
      await page.request.post(`${API}/flows/${id}/publish`, {
        headers: { ...ownerHeaders(owner), 'Idempotency-Key': `experience-${id}` },
        data: {},
      })
    ).status(),
  ).toBe(200)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/automations/${id}/edit`)
  await expect(page.getByRole('heading', { name: 'Price rule', exact: true })).toBeVisible()
  await expect(page.getByText('Published version', { exact: true })).toBeVisible()
  const original = await page.getByLabel('Reply message', { exact: true }).inputValue()
  await page.getByLabel('Reply message', { exact: true }).fill('New unpublished reply')
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await expect(page.getByText('Draft changes', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish changes', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Discard draft changes', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Discard draft changes?' })
    .getByRole('button', { name: 'Discard draft changes', exact: true })
    .click()
  await expect(page.getByLabel('Reply message', { exact: true })).toHaveValue(original)
  await expect(page.getByText('No draft changes', { exact: true })).toBeVisible()
  await expect(page.getByText('Draft changes discarded.', { exact: true })).not.toBeVisible()
  await quality(page, 'editor')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByText('Test', { exact: true }).click()
  const runsBefore = (
    await (
      await page.request.get(`${API}/flows/${id}/executions`, { headers: ownerHeaders(owner) })
    ).json()
  ).data
  await page.getByLabel('Sample incoming message', { exact: true }).fill('What is the price?')
  await page.getByRole('button', { name: 'Start test', exact: true }).click()
  const transcript = page.getByRole('region', { name: 'Test transcript' })
  await expect(transcript).toContainText('Matched “price” using whole-word matching.')
  await expect(transcript).toContainText('ELIGIBILITY_ALLOWED')
  await expect(transcript).toContainText(original)
  await page.getByLabel('Sample service window is open', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Restart test', exact: true }).click()
  await expect(transcript).toContainText('CONVERSATION_WINDOW_CLOSED')
  await page.getByLabel('Sample incoming message', { exact: true }).fill('prices')
  await page.getByRole('button', { name: 'Restart test', exact: true }).click()
  await expect(transcript).toContainText('“prices” did not match “price” in whole-word mode.')
  expect(
    (
      await (
        await page.request.get(`${API}/flows/${id}/executions`, { headers: ownerHeaders(owner) })
      ).json()
    ).data,
  ).toEqual(runsBefore)
  await page.route('**/api/v1/reply-studio/reports?*', async (route) => {
    const response = await route.fetch(),
      json = await response.json()
    json.data.failures = [
      {
        executionId: 'failure-fixture',
        flowId: id,
        conversationId: null,
        step: 'reply',
        code: 'CONTACT_BLOCKED',
        reason: 'This contact is blocked.',
        at: new Date().toISOString(),
      },
    ]
    await route.fulfill({ response, json })
  })
  await page.goto('/automations/reply-studio/reports')
  await page.getByRole('link', { name: 'Open step reply', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/automations/${id}/edit\\?node=reply&canvas=1`))
  await expect(page.getByTestId('flow-node-reply')).toHaveClass(/ring-2/)
  await expect(page.getByRole('heading', { name: 'Message', exact: true })).toBeVisible()
})
