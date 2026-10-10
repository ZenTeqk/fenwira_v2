import AxeBuilder from '@axe-core/playwright'
import { type Conversation, type Template } from '@fenwira/contracts'
import { expect, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  API,
  metaId,
  MOCK,
  type Owner,
  ownerHeaders,
  PASSWORD,
  resetRateLimits,
  signInAsNewOwner,
} from './support'

/**
 * Experience V2 UI/UX audit evidence (docs/design/experience-v2/UI_UX_AUDIT.md).
 * Opt-in: `UI_AUDIT_PHASE=before|after`. One synthetic local workspace is seeded once through the
 * domain APIs (no data is embedded in application code) and reused, so both phases show the same
 * records. Captures the nine in-scope screens at 1440×1000 and checks 1440/1280/1024/768/390 for
 * page overflow, WCAG 2.2 AA (axe) and console errors.
 */
const PHASE = process.env.UI_AUDIT_PHASE
const ROOT = resolve(__dirname, '../../../docs/design/experience-v2/evidence/ui-ux-audit')
const FIXTURE = resolve(ROOT, 'fixture.json')
const WIDTHS = [1440, 1280, 1024, 768, 390] as const
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

type Fixture = Owner & { flowId: string; templateVersionId: string; simulatedOnly: true }

test.describe.configure({ mode: 'serial' })
test.skip(!PHASE, 'Opt-in audit evidence: set UI_AUDIT_PHASE=before|after')
test.beforeEach(() => resetRateLimits())

async function waitForTemplate(page: Page, headers: Record<string, string>, id: string) {
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/templates/${id}`, { headers })).json()).data.status,
      { timeout: 30_000 },
    )
    .toBe('APPROVED')
}

async function seed(page: Page): Promise<Fixture> {
  for (const url of [API, MOCK]) expect(['localhost', '127.0.0.1']).toContain(new URL(url).hostname)
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  const headers = ownerHeaders(owner)
  const wabaId = metaId()
  const phoneNumberId = metaId()
  const seeded = await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      name: 'Acme Electronics',
      phones: [{ id: phoneNumberId, verifiedName: 'Acme Electronics', display: '+1 555-010-2030' }],
    }),
  })
  expect(seeded.ok).toBe(true)
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    headers,
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
  })
  expect(connected.status(), await connected.text()).toBe(201)
  const phoneId = (await connected.json()).data.id as string

  const tagIds: Record<string, string> = {}
  for (const [name, color] of [
    ['New customer', 'PRIMARY'],
    ['TV', 'INFO'],
    ['Festival offer', 'WARNING'],
    ['Wholesale', 'NEUTRAL'],
  ] as const) {
    const tag = await page.request.post(`${API}/tags`, { headers, data: { name, color } })
    expect(tag.status(), await tag.text()).toBe(201)
    tagIds[name] = (await tag.json()).data.id
  }

  // Synthetic customers (local review only). Phone numbers are fictional test ranges.
  const people = [
    [
      'Priya Sharma',
      ['New customer', 'TV'],
      'Do you have the 55-inch 4K TV? Can you share the price?',
    ],
    ['ABC Electronics', ['Wholesale'], 'Thank you. Can you confirm delivery tomorrow?'],
    ['Anita Rao', ['Festival offer'], 'Do you have a Diwali offer?'],
    ['Kumar Stores', ['Wholesale'], 'Is this available in Nagercoil?'],
    ['Suresh Kumar', ['TV'], 'What is the warranty on this TV?'],
    ['Lakshmi Traders', ['Wholesale'], 'Please share the catalogue.'],
    ['Mohan Raj', [], null],
    ['Vignesh', ['TV'], null],
    ['Revathi', ['Festival offer'], null],
    ['Selvam Electronics', ['Wholesale'], null],
  ] as const
  const contactIds: string[] = []
  for (const [i, [name, tags, text]] of people.entries()) {
    const phone = `9194998810${String(i).padStart(2, '0')}`
    const contact = await page.request.post(`${API}/contacts`, {
      headers,
      data: {
        name,
        phone: `+${phone}`,
        tagIds: tags.map((t) => tagIds[t]),
        consents: [
          {
            purpose: 'MARKETING',
            status: 'GRANTED',
            source: 'MANUAL',
            note: 'Synthetic local audit',
          },
        ],
      },
    })
    expect(contact.status(), await contact.text()).toBe(201)
    contactIds.push((await contact.json()).data.id)
    if (text) {
      const inbound = await fetch(`${MOCK}/__mock/inbound`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId, from: phone, name, text }),
      })
      expect(inbound.ok).toBe(true)
    }
  }
  let conversations: Conversation[] = []
  await expect
    .poll(async () => {
      conversations = (
        await (await page.request.get(`${API}/conversations?view=all`, { headers })).json()
      ).data
      return conversations.length
    })
    .toBe(6)
  const priya = conversations.find((c) => c.contact.name === 'Priya Sharma')!
  const reply = await page.request.post(`${API}/conversations/${priya.id}/messages`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      content: {
        type: 'TEXT',
        text: 'Hi Priya! Yes, the 55" 4K Smart TV is available. Would you like to see the models and offers?',
      },
    },
  })
  expect(reply.status(), await reply.text()).toBe(201)
  const note = await page.request.post(`${API}/contacts/${priya.contact.id}/notes`, {
    headers,
    data: { body: 'Interested in the 55" TV. Share the festival offer and follow up tomorrow.' },
  })
  expect(note.status(), await note.text()).toBe(201)

  const accounts = (await (await page.request.get(`${API}/templates/accounts`, { headers })).json())
    .data as Array<{ id: string; metaWabaId: string }>
  const accountId = accounts.find((a) => a.metaWabaId === wabaId)!.id
  const templates: Template[] = []
  for (const [name, category, text, button, submit] of [
    [
      'festive_offer',
      'MARKETING',
      'Hi {{1}} 👋\nCelebrate the festive season with special offers from Acme Electronics. Save up to 20% on selected products.',
      'View offers',
      true,
    ],
    [
      'order_confirmation',
      'UTILITY',
      'Hi {{1}}, your order {{2}} has been confirmed. We will notify you when it is dispatched.',
      'Track order',
      true,
    ],
    [
      'service_reminder',
      'UTILITY',
      'Hi {{1}}, your product service is due on {{2}}. Please schedule your service to keep it running smoothly.',
      null,
      true,
    ],
    [
      'diwali_offer_2026',
      'MARKETING',
      'Hi {{1}} 👋\nThis Diwali, bring home happiness with exclusive deals on TVs and appliances.',
      'Shop now',
      false,
    ],
  ] as const) {
    const vars = (text.match(/\{\{\d\}\}/g) ?? []).length
    const created = await page.request.post(`${API}/templates`, {
      headers,
      data: {
        wabaId: accountId,
        name,
        language: 'en',
        category,
        components: {
          body: { text },
          ...(button
            ? { buttons: [{ type: 'URL', text: button, url: 'https://example.com/acme-demo' }] }
            : {}),
        },
        samples: { body: ['Priya', 'ORD-1042'].slice(0, vars) },
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    const template = (await created.json()).data as Template
    if (submit) {
      const submitted = await page.request.post(`${API}/templates/${template.id}/submit`, {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      })
      expect(submitted.ok(), await submitted.text()).toBe(true)
      await waitForTemplate(page, headers, template.id)
    }
    templates.push(template)
  }
  const festive = templates[0]!
  const service = templates[2]!

  const draftCampaign = async (name: string, template: Template, extra = {}) => {
    const created = await page.request.post(`${API}/campaigns`, {
      headers,
      data: {
        name,
        phoneNumberId: phoneId,
        templateVersionId: template.currentVersion.id,
        // Only customers who haven't written in, so real conversations keep their own latest message.
        audience: { include: [{ kind: 'CONTACTS', contactIds: contactIds.slice(6) }], exclude: [] },
        variableMapping: { body: [{ kind: 'FIELD', field: 'firstName' }] },
        ...extra,
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    return (await created.json()).data.id as string
  }
  const launch = async (id: string) => {
    const launched = await page.request.post(`${API}/campaigns/${id}/launch`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(launched.ok(), await launched.text()).toBe(true)
  }
  const completed = await draftCampaign('October customer update', service, {
    variableMapping: {
      body: [
        { kind: 'FIELD', field: 'firstName' },
        { kind: 'STATIC', value: '15 October' },
      ],
    },
  })
  await launch(completed)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/campaigns/${completed}`, { headers })).json()).data
          .status,
      { timeout: 60_000 },
    )
    .toBe('COMPLETED')
  await launch(
    await draftCampaign('Weekend sale', festive, {
      scheduleAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    }),
  )
  await draftCampaign('Diwali electronics offer', festive)

  const flow = (
    await (
      await page.request.post(`${API}/flows`, {
        headers,
        data: {
          name: 'New lead follow-up',
          description: 'Automatically follow up with new WhatsApp leads.',
        },
      })
    ).json()
  ).data
  const draft = (
    await (await page.request.get(`${API}/flows/${flow.id}/draft`, { headers })).json()
  ).data
  const saved = await page.request.put(`${API}/flows/${flow.id}/draft`, {
    headers: { ...headers, 'If-Match': draft.etag },
    data: {
      graph: {
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.message_received',
            config: { onlyNewConversation: true },
          },
          {
            id: 'check',
            type: 'condition.has_tag',
            config: { tagIds: [tagIds['New customer']], match: 'ANY' },
          },
          {
            id: 'message',
            type: 'action.send_message',
            config: {
              text: 'Hi {{contact.firstName}} 👋\n\nThanks for contacting Acme Electronics. How can we help?',
            },
          },
          { id: 'wait', type: 'action.delay', config: { amount: 2, unit: 'HOURS' } },
          { id: 'tag', type: 'action.add_tag', config: { tagIds: [tagIds['TV']] } },
          { id: 'end', type: 'action.end', config: {} },
          { id: 'other', type: 'action.end', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'check', sourceHandle: 'next' },
          { id: 'e2', source: 'check', target: 'message', sourceHandle: 'yes' },
          { id: 'e3', source: 'check', target: 'other', sourceHandle: 'no' },
          { id: 'e4', source: 'message', target: 'wait', sourceHandle: 'next' },
          { id: 'e5', source: 'wait', target: 'tag', sourceHandle: 'next' },
          { id: 'e6', source: 'tag', target: 'end', sourceHandle: 'next' },
        ],
      },
    },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  const key = await page.request.post(`${API}/api-keys`, {
    headers,
    data: { name: 'Order system', scopes: ['contacts.read', 'inbox.reply'] },
  })
  expect(key.status(), await key.text()).toBe(201)
  const hook = await page.request.post(`${API}/webhook-endpoints`, {
    headers,
    data: {
      name: 'Order system',
      url: 'https://example.com/acme-demo/webhooks',
      events: ['message.inbound.received', 'campaign.completed'],
    },
  })
  expect(hook.status(), await hook.text()).toBe(201)

  const fixture: Fixture = {
    ...owner,
    flowId: flow.id,
    templateVersionId: festive.currentVersion.id,
    simulatedOnly: true,
  }
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(
    FIXTURE,
    JSON.stringify(
      { ...fixture, csrf: undefined, note: 'Synthetic local review workspace; mock Meta only.' },
      null,
      2,
    ),
  )
  return fixture
}

async function signIn(page: Page): Promise<Fixture> {
  if (!existsSync(FIXTURE)) return seed(page)
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  expect(fixture.simulatedOnly).toBe(true)
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(fixture.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  return fixture
}

type Screen = { id: string; path: (f: Fixture) => string; prepare?: (page: Page) => Promise<void> }
const SCREENS: Screen[] = [
  { id: '01-home', path: () => '/dashboard' },
  {
    id: '02-inbox',
    path: () => '/inbox',
    prepare: async (page) => {
      const row = page.getByRole('button', { name: /Priya Sharma/ }).first()
      if (await row.count()) await row.click()
    },
  },
  {
    id: '03-contacts',
    path: () => '/contacts',
    prepare: async (page) => {
      const row = page.getByRole('button', { name: /Priya Sharma/ }).first()
      if (await row.count()) await row.click()
    },
  },
  {
    id: '04-templates',
    path: () => '/templates',
    prepare: async (page) => {
      const preview = page.getByRole('button', { name: 'Preview festive_offer' })
      if (await preview.count()) await preview.click()
    },
  },
  { id: '05-campaigns', path: () => '/campaigns' },
  {
    id: '06-campaign-create',
    path: (f) => `/campaigns/new?templateVersionId=${f.templateVersionId}`,
    prepare: async (page) => {
      await page.getByLabel('Campaign name').fill('Diwali electronics offer')
      const tag = page
        .getByRole('group', { name: 'Tags', exact: true })
        .getByRole('checkbox', { name: 'Festival offer' })
      if (!(await tag.count())) return
      await tag.check()
      for (let i = 0; i < 2; i++) {
        const next = page.getByRole('button', { name: 'Save and continue' })
        if (!(await next.isEnabled())) return
        await next.click()
        await page.waitForTimeout(1500)
      }
    },
  },
  { id: '07-automation-studio', path: (f) => `/automations/${f.flowId}` },
  { id: '08-analytics', path: () => '/analytics' },
  { id: '09-integrations', path: () => '/integrations' },
]

test('UI/UX audit evidence for the nine Experience V2 screens', async ({ page }) => {
  test.setTimeout(900_000)
  const fixture = await signIn(page)
  const dir = resolve(ROOT, PHASE!)
  mkdirSync(dir, { recursive: true })
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${page.url()} ${m.text()}`.slice(0, 300))
  })
  page.on('pageerror', (e) => errors.push(`${page.url()} pageerror ${e.message}`.slice(0, 300)))
  // UI_AUDIT_ONLY=03,04 captures a subset; each screen writes its own checks file.
  const only = process.env.UI_AUDIT_ONLY?.split(',')
  for (const screen of SCREENS.filter((s) => !only || only.some((o) => s.id.startsWith(o)))) {
    const before = errors.length
    const result: Record<string, unknown> = {}
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
      await page.goto(screen.path(fixture))
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
      await page.waitForLoadState('networkidle')
      await screen.prepare?.(page)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
      result[width] = {
        overflow,
        axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      }
      if (width === 1440) {
        await page.screenshot({ path: resolve(dir, `${screen.id}-1440.png`) })
        await page.screenshot({ path: resolve(dir, `${screen.id}-1440-full.png`), fullPage: true })
      } else
        await page.screenshot({ path: resolve(dir, `${screen.id}-${width}.png`), fullPage: true })
    }
    writeFileSync(
      resolve(dir, `${screen.id}-checks.json`),
      JSON.stringify(
        { capturedAt: new Date().toISOString(), result, consoleErrors: errors.slice(before) },
        null,
        2,
      ),
    )
  }
})
