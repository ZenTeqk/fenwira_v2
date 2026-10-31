import AxeBuilder from '@axe-core/playwright'
import { type Conversation, type DraftGraph, FLOW_TEMPLATES, replyPreset } from '@fenwira/contracts'
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inbound } from './inbox-fixtures'
import {
  API,
  customerWritesIn,
  metaId,
  type Owner,
  ownerHeaders,
  refreshCsrf,
  signInAsNewOwner,
  applyReviewTheme,
  applyWebUpstream,
} from './support'

// Light-mode review of Automations, the flow builder, Reply Studio and AI Assistant. Records are
// created through the domain APIs (starter graphs and Reply Studio presets from @fenwira/contracts)
// and the Meta mock; AUTOMATION_SHOTS_DIR saves review screenshots.
const shots = process.env.AUTOMATION_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForLoadState('networkidle')
  if (shots)
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage, animations: 'disabled' })
}
/** The same view on the dark tokens (data-theme, no switcher); transitions finish instantly. */
const darkShot = async (page: Page, name: string, fullPage = false) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await shot(page, `${name}-dark`, fullPage)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  // Switching back runs colour transitions; later checks (axe) must see the settled theme.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
}
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([])
const noPageOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)

/** The operator switch for AI, set in the local database (same fixture as ai-assistant.spec.ts). */
function enableAi(tenantId: string) {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('bad tenant id')
  const sql = `INSERT INTO ai_settings (tenant_id, enabled, monthly_message_quota, business_name, handoff_message, updated_at)
    VALUES ('${tenantId}', true, 100, 'Acme Electronics', 'A teammate will reply soon.', now())
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, monthly_message_quota = 100`
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'fenwira-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'fenwira',
      '-c',
      sql,
    ],
    { cwd: resolve(__dirname, '../../..') },
  )
}

const keywordGraph = (keyword: string, text: string, tagId: string): DraftGraph => ({
  nodes: [
    {
      id: 'trigger',
      type: 'trigger.keyword',
      config: { keywords: [keyword], match: 'CONTAINS', caseSensitive: false },
    },
    { id: 'reply', type: 'action.send_message', config: { text } },
    { id: 'tag', type: 'action.add_tag', config: { tagIds: [tagId] } },
    { id: 'end', type: 'action.end', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'reply', sourceHandle: 'next' },
    { id: 'e2', source: 'reply', target: 'tag', sourceHandle: 'next' },
    { id: 'e3', source: 'tag', target: 'end', sourceHandle: 'next' },
  ],
  layout: {},
})

async function seed(page: Page) {
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  // A real customer conversation also connects the mock WhatsApp number.
  await customerWritesIn(page, owner, 'Hi, I would like to know more.')
  const headers = async () => {
    await refreshCsrf(page, owner)
    return ownerHeaders(owner)
  }
  const tag = await page.request.post(`${API}/tags`, {
    headers: await headers(),
    data: { name: 'Price enquiry', color: 'INFO' },
  })
  expect(tag.status(), await tag.text()).toBe(201)
  const tagId = (await tag.json()).data.id as string

  const createFlow = async (
    name: string,
    graph: DraftGraph,
    options: { publish?: boolean; pause?: boolean; managedBy?: 'REPLY_STUDIO' } = {},
  ) => {
    const created = await page.request.post(`${API}/flows`, {
      headers: await headers(),
      data: { name, ...(options.managedBy ? { managedBy: options.managedBy } : {}) },
    })
    expect(created.status(), await created.text()).toBe(201)
    const id = (await created.json()).data.id as string
    const draft = (
      await (
        await page.request.get(`${API}/flows/${id}/draft`, { headers: await headers() })
      ).json()
    ).data as { etag: string }
    const saved = await page.request.put(`${API}/flows/${id}/draft`, {
      headers: { ...(await headers()), 'If-Match': draft.etag },
      data: { graph },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    if (options.publish) {
      const published = await page.request.post(`${API}/flows/${id}/publish`, {
        headers: { ...(await headers()), 'Idempotency-Key': `pub-${metaId()}` },
      })
      expect(published.ok(), await published.text()).toBe(true)
    }
    if (options.pause) {
      const paused = await page.request.post(`${API}/flows/${id}/pause`, {
        headers: await headers(),
      })
      expect(paused.ok(), await paused.text()).toBe(true)
    }
    return id
  }
  const starter = (id: string) => FLOW_TEMPLATES.find((t) => t.id === id)!.graph()

  const active = await createFlow(
    'Price list reply for customers asking about television and appliance prices',
    keywordGraph(
      'price',
      'Thanks for asking! Our latest price list is attached. A teammate will follow up shortly.',
      tagId,
    ),
    { publish: true },
  )
  await createFlow(
    'Store timings reply',
    keywordGraph('timings', 'We are open 10am to 8pm, Monday to Saturday.', tagId),
    { publish: true, pause: true },
  )
  const router = await createFlow('Template button router', starter('template-button-router'))
  await createFlow('Lead capture', starter('lead-capture'))
  await createFlow('Out of hours', starter('out-of-hours'))

  // A real execution of the active flow from a customer message.
  const conversation = (
    (
      await (
        await page.request.get(`${API}/conversations?view=all`, { headers: await headers() })
      ).json()
    ).data as Conversation[]
  )[0]!
  const connection = (
    (
      await (
        await page.request.get(`${API}/whatsapp/connections`, { headers: await headers() })
      ).json()
    ).data as Array<{ id: string; phoneNumberId: string }>
  ).find((c) => c.id === conversation.phoneNumber.id)!
  await inbound(
    connection.phoneNumberId,
    conversation.contact.phoneE164.replace(/^\+/, ''),
    conversation.contact.waProfileName ?? 'Customer',
    'Can you share the price list?',
  )
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${API}/flows/${active}/executions`, {
              headers: await headers(),
            })
          ).json()
        ).data.length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)

  const keywordReply = await createFlow('Price keyword reply', replyPreset('keyword'), {
    managedBy: 'REPLY_STUDIO',
  })
  await createFlow('Product enquiry', replyPreset('product-enquiry'), { managedBy: 'REPLY_STUDIO' })
  return { owner, headers, active, router, keywordReply }
}

let seeded: Awaited<ReturnType<typeof seed>> & { owner: Owner }
// One signed-in page for the whole review: the tests share the seeded workspace and session.
let page: Page

test.describe.configure({ mode: 'serial' })
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  })
  // This file shares one page, so the review helpers apply to its own context.
  await applyWebUpstream(context)
  await applyReviewTheme(context)
  page = await context.newPage()
  seeded = await seed(page)
})
test.afterAll(async () => {
  await page.context().close()
})

test('Automations: workflows, starters and execution history', async () => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/workflows')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Store timings reply').first()).toBeVisible()
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'workflows-1440', true)
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `workflows-${width}`, width === 375)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('tab', { name: /Starter workflows/ }).click()
  await shot(page, 'workflows-starters-1440', true)
  await page.goto(`/automations/${seeded.active}/history`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await axe(page)
  await shot(page, 'history-1440', true)
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'history-375', true)
})

test('Flow builder: canvas, selection, settings, readiness and narrow layouts', async () => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/automations/${seeded.router}/edit`)
  const canvas = page.locator('.react-flow')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await shot(page, 'builder-1440')
  await page.locator('.react-flow__node').nth(1).click()
  await page.locator('.react-flow__node').nth(2).hover()
  await shot(page, 'builder-1440-selected')
  const checklist = page.getByRole('button', { name: /Setup checklist/ })
  if (await checklist.count()) {
    await checklist.first().click()
    await shot(page, 'builder-1440-readiness')
    await page.keyboard.press('Escape')
  }
  // Dark tokens (no switcher): canvas, nodes, handles, edges and controls must stay legible.
  await darkShot(page, 'builder-1440-selected')
  await page.goto(`/automations/${seeded.active}/edit`)
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await shot(page, 'builder-published-1440')
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `builder-${width}`)
  }
})

test('Reply Studio: auto replies, bot flows, editor, wizard, hours and reports', async () => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/reply-studio/auto-replies')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'reply-auto-replies-1440', true)
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'reply-auto-replies-375', true)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [path, file] of [
    ['bot-flows', 'reply-bot-flows-1440'],
    ['new', 'reply-wizard-1440'],
    ['business-hours', 'reply-business-hours-1440'],
    ['reports', 'reply-reports-1440'],
  ] as const) {
    await page.goto(`/automations/reply-studio/${path}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await axe(page)
    await shot(page, file, true)
  }
  await page.goto(`/automations/${seeded.keywordReply}/edit`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
  await shot(page, 'reply-editor-1440')
  await darkShot(page, 'reply-editor-1440')
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'reply-editor-375')
  await darkShot(page, 'reply-editor-375')
})

test('AI Assistant: activation, overview, knowledge, test, behaviour and activity', async () => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/ai-assistant')
  await expect(page.getByRole('button', { name: 'Request activation' }).first()).toBeVisible()
  await axe(page)
  await shot(page, 'ai-activation-1440', true)
  await darkShot(page, 'ai-activation-1440', true)
  enableAi(seeded.owner.tenantId)
  const added = await page.request.post(`${API}/ai/knowledge/text`, {
    headers: await seeded.headers(),
    data: {
      title: 'Store information',
      text: 'Acme Electronics is open from 10am to 8pm, Monday to Saturday. Installation is free for televisions above 50 inches.',
    },
  })
  expect(added.status(), await added.text()).toBe(201)
  await page.goto('/ai-assistant')
  await expect(page.getByRole('heading', { name: 'AI Assistant', level: 1 })).toBeVisible()
  await axe(page)
  await shot(page, 'ai-overview-1440', true)
  await darkShot(page, 'ai-overview-1440', true)
  for (const [tab, file] of [
    ['Knowledge', 'ai-knowledge-1440'],
    ['Behaviour', 'ai-behaviour-1440'],
    ['Activity', 'ai-activity-1440'],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click()
    await axe(page)
    await shot(page, file, true)
    await darkShot(page, file, true)
  }
  await page.getByRole('tab', { name: 'Test' }).click()
  await page.getByLabel('Test question').fill('Is installation free for a 55-inch television?')
  await page.getByRole('button', { name: 'Ask' }).click()
  const log = page.getByRole('log', { name: 'Test conversation' })
  // The answer has arrived: the placeholder is gone and the labelled AI answer is shown.
  await expect(log.getByText('Thinking…')).toHaveCount(0)
  await expect(log.getByText('AI', { exact: true }).last()).toBeVisible()
  await axe(page)
  await shot(page, 'ai-test-1440', true)
  await darkShot(page, 'ai-test-1440', true)
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'ai-test-375', true)
})
