import AxeBuilder from '@axe-core/playwright'
import { type DraftGraph, type Execution, type ExecutionStep } from '@fenwira/contracts'
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mockFrontend } from './frontend-fixture'

// Browser-only fixture for execution failure details: the API responses are mocked, so no
// customer message is sent and no execution runs. FAILURE_SHOTS_DIR saves review screenshots.
const shots = process.env.FAILURE_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const shot = async (page: Page, name: string) => {
  if (shots)
    await page.screenshot({
      path: join(shots, `${name}.png`),
      fullPage: true,
      animations: 'disabled',
    })
}

const FLOW = 'flow-fixture'
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const graph: DraftGraph = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger.keyword',
      config: { keywords: ['price'], match: 'CONTAINS', caseSensitive: false },
    },
    { id: 'reply', type: 'action.send_message', config: { text: 'Here is our price list.' } },
    { id: 'notify', type: 'action.webhook', config: { url: 'https://example.com/hook' } },
    { id: 'end', type: 'action.end', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'reply', sourceHandle: 'next' },
    { id: 'e2', source: 'reply', target: 'notify', sourceHandle: 'next' },
    { id: 'e3', source: 'notify', target: 'end', sourceHandle: 'next' },
  ],
  layout: {
    trigger: { x: 0, y: 0 },
    reply: { x: 0, y: 190 },
    notify: { x: 0, y: 380 },
    end: { x: 0, y: 570 },
  },
}
const run = (id: string, contactName: string, errorCode: string): Execution => ({
  id,
  flowId: FLOW,
  flowVersionId: 'version-2',
  flowVersion: 2,
  contactId: `contact-${id}`,
  contactName,
  conversationId: null,
  status: 'FAILED',
  currentNodeId: null,
  waitUntil: null,
  stepCount: 2,
  errorCode,
  errorDetail: null,
  triggerRunId: null,
  startedAt: at(12),
  finishedAt: at(11),
})
const step = (
  seq: number,
  nodeId: string,
  nodeType: string,
  extra: Partial<ExecutionStep> = {},
) => ({
  seq,
  nodeId,
  nodeType,
  status: 'SUCCEEDED' as const,
  input: {},
  output: {},
  errorCode: null,
  errorDetail: null,
  startedAt: at(12),
  finishedAt: at(12),
  ...extra,
})
const runs = {
  window: {
    ...run('run-window', 'Asha Rao', 'CONVERSATION_WINDOW_CLOSED'),
    steps: [
      step(1, 'trigger', 'trigger.keyword', { output: { matched: 'price' } }),
      step(2, 'reply', 'action.send_message', {
        status: 'FAILED',
        input: { text: 'Here is our price list.' },
        errorCode: 'CONVERSATION_WINDOW_CLOSED',
      }),
    ],
  },
  webhook: {
    ...run('run-webhook', 'Ravi Kumar', 'WEBHOOK_HTTP_ERROR'),
    stepCount: 3,
    steps: [
      step(1, 'trigger', 'trigger.keyword'),
      step(2, 'reply', 'action.send_message'),
      step(3, 'notify', 'action.webhook', {
        status: 'FAILED',
        errorCode: 'WEBHOOK_HTTP_ERROR',
        errorDetail: 'The endpoint answered 500 Internal Server Error.',
      }),
    ],
  },
}

async function mockHistory(page: Page) {
  await mockFrontend(page)
  const flow = {
    id: FLOW,
    name: 'Price list reply',
    description: null,
    status: 'ACTIVE',
    priority: 100,
    reentryPolicy: 'ALWAYS',
    triggerType: 'trigger.keyword',
    trigger: null,
    liveTrigger: null,
    activeVersion: 2,
    draftUpdatedAt: null,
    hasWebhookToken: false,
    managedBy: null,
    executions: { running: 0, total: 2, last7d: 2 },
    createdAt: at(600),
    updatedAt: at(60),
  }
  // Registered after mockFrontend, so these specific routes are matched first.
  await page.route('**/api/v1/flows/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    if (path === `/flows/${FLOW}`) return route.fulfill({ json: { data: flow } })
    if (path === `/flows/${FLOW}/executions`)
      return route.fulfill({
        json: { data: [runs.window, runs.webhook].map(({ steps: _steps, ...e }) => e) },
      })
    if (path === `/flows/${FLOW}/versions/version-2`)
      return route.fulfill({
        json: { data: { id: 'version-2', version: 2, state: 'PUBLISHED', graph, etag: 'v2' } },
      })
    return route.fulfill({ json: { data: [] } })
  })
  await page.route('**/api/v1/executions/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    const detail = Object.values(runs).find((r) => r.id === id)
    return detail
      ? route.fulfill({ json: { data: detail } })
      : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } })
  })
}

const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([])

test('execution history explains failed steps with readable and coded reasons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockHistory(page)
  await page.goto(`/automations/${FLOW}/history`)
  const table = page.getByRole('table', { name: 'Runs' })
  await expect(table.getByRole('row', { name: /Asha Rao/ }).getByText('Failed')).toBeVisible()
  await expect(table.getByRole('row', { name: /Ravi Kumar/ }).getByText('Failed')).toBeVisible()
  await axe(page)
  await shot(page, 'history-failed-list-1440')

  // A known error code: the plain-language reason, with the code kept for support.
  await table.getByRole('link', { name: 'Asha Rao' }).click()
  await expect(page).toHaveURL(/run=run-window/)
  const detail = page.getByRole('region', { name: /Run for Asha Rao · version 2/ })
  await expect(detail.getByText('Failed').first()).toBeVisible()
  await expect(detail.getByText('CONVERSATION_WINDOW_CLOSED', { exact: true })).toBeVisible()
  const reason = detail.getByText(
    'The 24-hour window was closed. Use a template to reach this contact.',
  )
  await expect(reason).toBeVisible()
  await expect(reason).toContainText('(CONVERSATION_WINDOW_CLOSED)')
  // The reason uses the error role colour, not muted text.
  await expect(reason).toHaveClass(/text-status-error-fg/)
  await axe(page)
  await shot(page, 'history-failed-detail-1440')

  // The run on its canvas: the replayed path and the failed step stay distinguishable.
  await detail.getByRole('button', { name: 'Show on canvas' }).click()
  await expect(detail.locator('.react-flow__node').first()).toBeVisible()
  // Each replayed step carries its labelled step status; the failure is visible on the canvas.
  await expect(detail.getByTestId('flow-node-trigger').getByText('Succeeded')).toBeVisible()
  await expect(detail.getByTestId('flow-node-reply').getByText('Failed')).toBeVisible()
  await shot(page, 'history-failed-canvas-1440')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shot(page, 'history-failed-canvas-1440-dark')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))

  // An unknown code falls back to the provider's detail, still with the code.
  await page.getByRole('button', { name: 'Back to all runs' }).click()
  await table.getByRole('link', { name: 'Ravi Kumar' }).click()
  const second = page.getByRole('region', { name: /Run for Ravi Kumar/ })
  const detailText = second.getByText('The endpoint answered 500 Internal Server Error.')
  await expect(detailText).toBeVisible()
  await expect(detailText).toContainText('(WEBHOOK_HTTP_ERROR)')
  await page.setViewportSize({ width: 375, height: 812 })
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0)
  await axe(page)
  await shot(page, 'history-failed-detail-375')
})
