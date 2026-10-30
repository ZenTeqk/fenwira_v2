import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  DEFAULT_BUSINESS_HOURS,
  FLOW_TEMPLATES,
  replyPreset,
  type DraftGraph,
  type Flow,
} from '@fenwira/contracts'
import { mkdirSync } from 'node:fs'
import { mockFrontend } from './frontend-fixture'

// Browser-only populated fixtures. Nothing here is seeded into a tenant or sent to WhatsApp.
async function dashboards(page: Page) {
  await mockFrontend(page, ['analytics.read', 'whatsapp.read'])
  const graphs = new Map<string, DraftGraph>()
  function flow(name: string, graph: DraftGraph, status: Flow['status'], studio = false): Flow {
    const id = `reference-${graphs.size}`
    graphs.set(id, graph)
    const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'))!
    return {
      id,
      name,
      description: studio ? null : 'Keep incoming enquiries organised for your team.',
      status,
      priority: 100,
      reentryPolicy: 'ALWAYS',
      triggerType: trigger.type as Flow['triggerType'],
      trigger: {
        type: trigger.type as NonNullable<Flow['trigger']>['type'],
        config: trigger.config,
      },
      liveTrigger: null,
      activeVersion: status === 'DRAFT' ? null : 1,
      draftUpdatedAt: null,
      hasWebhookToken: false,
      managedBy: studio ? 'REPLY_STUDIO' : null,
      ...(studio ? { replyStudioKind: graph.replyStudio?.kind ?? 'AUTO_REPLY' } : {}),
      executions: {
        running: 0,
        total: status === 'DRAFT' ? 0 : 50,
        last7d: status === 'DRAFT' ? 0 : 12,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
  const template = (id: string) => FLOW_TEMPLATES.find((t) => t.id === id)!.graph()
  const flows = [
    flow('Enquiry routing', template('lead-capture'), 'ACTIVE'),
    flow('Keyword tagging', template('keyword-reply'), 'ACTIVE'),
    flow('CRM lead assignment', template('crm-lead-sync'), 'ACTIVE'),
    flow('Contact follow-up', template('follow-up-no-reply'), 'PAUSED'),
    flow('New customer journey', template('new-customer-journey'), 'DRAFT'),
    flow('FAQ menu', replyPreset('faq'), 'ACTIVE', true),
    flow('Welcome message', replyPreset('welcome'), 'ACTIVE', true),
    flow('Store location', replyPreset('keyword'), 'ACTIVE', true),
    flow('Outside business hours', replyPreset('out-of-hours'), 'ACTIVE', true),
    flow('Pricing enquiry', replyPreset('keyword'), 'DRAFT', true),
    flow('Delivery details', replyPreset('keyword'), 'PAUSED', true),
  ]
  flows[9]!.trigger!.config.keywords = ['price', 'cost']
  flows[10]!.trigger!.config.keywords = ['delivery', 'shipping']
  flows[6]!.trigger!.config.phoneNumberIds = ['main']
  await page.route('**/api/v1/flows**', async (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[4]
    const data = url.pathname.endsWith('/draft')
      ? { id: `${id}-draft`, graph: graphs.get(id!), version: 1, state: 'DRAFT', etag: '"1"' }
      : url.pathname.endsWith('/executions')
        ? [{ startedAt: new Date(Date.now() - 120000).toISOString() }]
        : url.searchParams.has('archived')
          ? []
          : flows
    await route.fulfill({ json: { data } })
  })
  await page.route('**/api/v1/analytics/automations?*', (route) =>
    route.fulfill({
      json: {
        meta: { freshness: { status: 'READY' } },
        kpis: { executions: { value: 108 }, failed: { value: 3 }, successRate: { value: 0.972 } },
        flows: flows.map((f, i) => ({ flowId: f.id, failed: i === 3 ? 3 : 0 })),
      },
    }),
  )
  await page.route('**/api/v1/reply-studio/reports?*', (route) =>
    route.fulfill({
      json: {
        data: {
          totals: { starts: 48, completions: 40, handovers: 6, failures: 2 },
          failures: [],
          flows: [],
        },
      },
    }),
  )
  await page.route('**/api/v1/reply-studio/business-hours', (route) =>
    route.fulfill({
      json: {
        data: {
          ...DEFAULT_BUSINESS_HOURS,
          etag: '"hours"',
        },
      },
    }),
  )
  await page.route('**/api/v1/whatsapp/connections', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'main',
            phoneNumberId: 'meta-main',
            displayPhoneNumber: '+91 90000 04821',
            verifiedName: 'Main store',
            label: 'Main store',
            status: 'CONNECTED',
          },
          {
            id: 'other',
            phoneNumberId: 'meta-other',
            displayPhoneNumber: '+91 90000 02531',
            verifiedName: 'Second store',
            status: 'CONNECTED',
          },
        ],
      },
    }),
  )
}
async function quality(page: Page, name: string) {
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 1440 || width === 375) {
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([])
      if (process.env.AUTOMATION_REFERENCE_SCREENSHOTS) {
        mkdirSync(process.env.AUTOMATION_REFERENCE_SCREENSHOTS, { recursive: true })
        await page.screenshot({
          path: `${process.env.AUTOMATION_REFERENCE_SCREENSHOTS}/${name}-${width}.png`,
          fullPage: width === 1440,
        })
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
test('reference dashboards preserve real graph previews, filters, starters and navigation', async ({
  page,
}) => {
  test.setTimeout(120000)
  await dashboards(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/automations/workflows')
  await expect(page.getByRole('article', { name: 'Enquiry routing', exact: true })).toContainText(
    'Add tag',
  )
  await quality(page, 'workflows')
  await page.getByRole('combobox', { name: 'Trigger', exact: true }).click()
  await page.getByRole('option', { name: 'Contact created', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Enquiry routing', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Trigger', exact: true }).click()
  await page.getByRole('option', { name: 'All triggers', exact: true }).click()
  await page.getByRole('button', { name: 'Execution history', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Execution history', exact: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('tab', { name: 'Starter workflows', exact: true }).click()
  await expect(
    page.getByRole('searchbox', { name: 'Search starter workflows', exact: true }),
  ).toBeVisible()
  await page.goto('/automations/reply-studio/auto-replies')
  await expect(page.getByRole('article', { name: 'Welcome message', exact: true })).toContainText(
    'ending 4821',
  )
  await expect(
    page.getByRole('article', { name: 'Outside business hours', exact: true }),
  ).toContainText('Outside business hours')
  await quality(page, 'reply-studio')
  await page.getByRole('combobox', { name: 'WhatsApp number', exact: true }).click()
  await page.getByRole('option', { name: /Second store/ }).click()
  await expect(page.getByRole('article', { name: 'Welcome message', exact: true })).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Store location', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Starter conversations', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Starter conversations', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('link', { name: /Bot Flows/ }).click()
  await expect(page.getByRole('article', { name: 'FAQ menu', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create bot flow', exact: true })).toBeVisible()
})
