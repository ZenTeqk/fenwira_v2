import AxeBuilder from '@axe-core/playwright'
import { chromium, expect, test, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { API, customerWritesIn, metaId, MOCK, ownerHeaders, signInAsNewOwner } from './support'

const WIDTHS = [1440, 1024, 768, 375]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function accessible(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
}

test('Contacts use server eligibility and lightweight context at four widths', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'batch2-contacts', 'Acme Retail')
  for (const [phone, name] of [
    ['+919811100001', 'Priya Shah'],
    ['+919811100002', 'Kumar Stores'],
  ]) {
    const res = await page.request.post(`${API}/contacts`, {
      headers: ownerHeaders(owner),
      data: {
        phone,
        name,
        consents:
          name === 'Priya Shah'
            ? [
                {
                  purpose: 'MARKETING',
                  status: 'GRANTED',
                  source: 'MANUAL',
                  note: 'Synthetic review fixture consent',
                },
              ]
            : [],
      },
    })
    expect(res.status(), await res.text()).toBe(201)
  }
  await page.goto('/contacts')
  await expect(page.getByText('2 contacts · Page 1', { exact: true })).toBeVisible()
  const table = page.getByRole('table', { name: 'Contacts', exact: true })
  await expect(table.getByText('Marketing allowed')).toBeVisible()
  await expect(table.getByText('Marketing restricted')).toBeVisible()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true })
    const trigger = page.getByRole('button', { name: /^Priya Shah(?: \+\d+)?$/ })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole(width >= 1280 ? 'complementary' : 'dialog', {
      name: 'Priya Shah',
      exact: true,
    })
    await drawer.getByText('Eligibility and consent details', { exact: true }).click()
    await expect(drawer.getByRole('region', { name: 'Messaging eligibility' })).toContainText(
      'Free-form replies',
    )
    await expect(drawer.getByText('Contact created', { exact: true })).toBeVisible()
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`contact-context-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const actions = page.getByRole('button', { name: 'Actions for Priya Shah' })
  await actions.click()
  await page.getByRole('menuitem', { name: 'Quick view' }).click()
  await expect(page.getByRole('complementary', { name: 'Priya Shah', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()
})

test('Contacts search errors and eligibility errors stay explicit and retryable', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'batch2-contact-errors')
  await page.request.post(`${API}/contacts`, {
    headers: ownerHeaders(owner),
    data: { phone: '+919811100003', name: 'Farah Ali' },
  })
  await page.route('**/api/v1/contacts/search', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Contacts temporarily unavailable' },
      }),
    }),
  )
  await page.goto('/contacts')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Contacts temporarily unavailable' }),
  ).toContainText('Contacts temporarily unavailable')
  await page.unroute('**/api/v1/contacts/search')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.route('**/api/v1/contacts/*/eligibility', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Eligibility unavailable' } }),
    }),
  )
  // The directory/context intentionally share the eligibility cache; force a fresh read for this failure fixture.
  await page.reload()
  await page.getByRole('button', { name: 'Farah Ali', exact: true }).click()
  const drawer = page.getByRole('complementary', { name: 'Farah Ali' })
  await expect(drawer.getByRole('alert')).toContainText('Eligibility couldn’t be loaded')
  await page.unroute('**/api/v1/contacts/*/eligibility')
  await drawer.getByRole('button', { name: 'Try again' }).click()
  await drawer.getByText('Eligibility and consent details', { exact: true }).click()
  await expect(drawer.getByRole('region', { name: 'Messaging eligibility' })).toBeVisible()
})

test('Templates are a real message library with filters and keyboard context at four widths', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'batch2-templates', 'Acme Retail')
  const headers = ownerHeaders(owner)
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  await fetch(`${MOCK}/__mock/templates`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      add: [
        {
          name: 'order_update',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Your order is ready' },
            {
              type: 'BODY',
              text: 'Hi {{1}}, your order is ready for collection. We look forward to seeing you.',
              example: { body_text: [['Priya']] },
            },
            { type: 'FOOTER', text: 'Acme Retail' },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'URL', text: 'View order', url: 'https://example.com/orders' }],
            },
          ],
        },
        {
          name: 'festival_offer',
          language: 'hi',
          category: 'MARKETING',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'हमारे नए उत्पाद देखें।' }],
        },
        {
          name: 'appointment_reminder',
          language: 'en',
          category: 'UTILITY',
          status: 'PENDING',
          components: [
            {
              type: 'BODY',
              text: 'Your appointment is tomorrow. Please arrive ten minutes early.',
            },
          ],
        },
        {
          name: 'collection_offer',
          language: 'en',
          category: 'MARKETING',
          status: 'REJECTED',
          rejected_reason: 'INVALID_FORMAT',
          components: [{ type: 'BODY', text: 'Explore our new collection in store.' }],
        },
        {
          name: 'weekly_update',
          language: 'en',
          category: 'MARKETING',
          status: 'PAUSED',
          components: [{ type: 'BODY', text: 'Discover what is new this week.' }],
        },
      ],
    }),
  })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    headers,
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
  })
  expect(connected.status(), await connected.text()).toBe(201)
  expect((await page.request.post(`${API}/templates/sync`, { headers, data: {} })).status()).toBe(
    200,
  )
  const accounts = (await (await page.request.get(`${API}/templates/accounts`, { headers })).json())
    .data
  const draft = await page.request.post(`${API}/templates`, {
    headers,
    data: {
      wabaId: accounts[0].id,
      name: 'welcome_draft',
      language: 'en',
      category: 'UTILITY',
      components: { body: { text: 'Welcome {{1}}, thank you for choosing us.' } },
      samples: { body: ['Priya'] },
    },
  })
  expect(draft.status(), await draft.text()).toBe(201)
  await page.goto('/templates')
  const library = page.getByRole('list', { name: 'Template library' })
  await expect(library.getByRole('link', { name: 'order_update', exact: true })).toBeVisible()
  await expect(library.getByText('Hi Priya, your order is ready', { exact: false })).toBeVisible()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`templates-${width}.png`), fullPage: true })
    const trigger = page.getByRole('button', { name: 'Preview order_update', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'order_update', exact: true })
    await expect(drawer.getByRole('figure', { name: 'Message preview' })).toContainText(
      'View order',
    )
    await expect(drawer.getByRole('link', { name: 'Open Inbox' })).toBeVisible()
    await accessible(page)
    await page.screenshot({
      path: info.outputPath(`template-context-${width}.png`),
      fullPage: false,
    })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  }
  await page.getByRole('tab', { name: 'Drafts', exact: true }).click()
  await expect(library.getByRole('link', { name: 'welcome_draft' })).toBeVisible()
  await expect(library.getByRole('link', { name: 'order_update' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'In review', exact: true }).click()
  await expect(library.getByRole('link', { name: 'appointment_reminder' })).toBeVisible()
  await page.getByRole('tab', { name: 'Needs attention', exact: true }).click()
  await expect(library.getByRole('link', { name: 'weekly_update' })).toBeVisible()
  await expect(library.getByRole('link', { name: 'collection_offer' })).toBeVisible()
  await page.getByRole('tab', { name: 'All templates', exact: true }).click()
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await page.getByRole('option', { name: 'Hindi', exact: true }).click()
  await expect(library.getByRole('link', { name: 'festival_offer' })).toBeVisible()
  await expect(library.getByRole('link', { name: 'order_update' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Utility', exact: true }).click()
  await expect(library.getByRole('link', { name: 'order_update' })).toBeVisible()
  await expect(library.getByRole('link', { name: 'festival_offer' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('nothing_matches')
  await expect(page.getByText('No matching templates')).toBeVisible()
})

test('Templates preserve drafts through submission failures and provide honest empty/error states', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'batch2-template-retry')
  const headers = ownerHeaders(owner)
  await page.goto('/templates')
  await expect(page.getByText('Your message library starts here')).toBeVisible()
  await accessible(page)
  const listRoute = /\/api\/v1\/templates(?:\?|$)/
  await page.route(listRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Template library unavailable' },
      }),
    }),
  )
  await page.reload()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Templates couldn’t be loaded' }),
  ).toContainText('Template library unavailable')
  await page.unroute(listRoute)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Your message library starts here')).toBeVisible()
  await customerWritesIn(page, owner, 'Synthetic template retry fixture')
  await page.goto('/templates/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('retry_notice')
  await page.getByRole('textbox', { name: 'Message text' }).fill('Hi {{1}}, your order is ready.')
  await page.getByLabel('Message {{1}}', { exact: true }).fill('Farah')
  await page.route('**/api/v1/templates/*/submit', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Submission unavailable; draft preserved' },
      }),
    }),
  )
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(
    page.getByText('Submission unavailable; draft preserved', { exact: true }),
  ).toBeVisible()
  const rows = (await (await page.request.get(`${API}/templates`, { headers })).json()).data
  const id = rows.find((t: { name: string }) => t.name === 'retry_notice').id
  // A saved draft must be opened after failed submission, so retry patches it rather than creating it twice.
  await expect(page).toHaveURL(new RegExp(`/templates/${id}$`))
  const draft = (await (await page.request.get(`${API}/templates/${id}`, { headers })).json()).data
  expect(draft.currentVersion.status).toBe('DRAFT')
  expect(draft.currentVersion.samples.body).toEqual(['Farah'])
  await expect(page.getByRole('textbox', { name: 'Message text' })).toHaveValue(
    'Hi {{1}}, your order is ready.',
  )
  await expect(
    page.getByText('Submission unavailable; draft preserved', { exact: true }),
  ).toBeHidden()
  await accessible(page)
  await page.unroute('**/api/v1/templates/*/submit')
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.locator('[data-status="APPROVED"]').first()).toBeVisible({ timeout: 30_000 })
})

async function campaignEnvironment(page: Page, label: string) {
  const owner = await signInAsNewOwner(page, label, 'Acme Retail')
  const headers = ownerHeaders(owner)
  const wabaId = metaId(),
    phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  await fetch(`${MOCK}/__mock/templates`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      add: [
        {
          name: 'delivery_update',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}, your delivery is on its way today.',
              example: { body_text: [['Priya']] },
            },
          ],
        },
      ],
    }),
  })
  const connection = await page.request.post(`${API}/whatsapp/connections/dev`, {
    headers,
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
  })
  expect(connection.status(), await connection.text()).toBe(201)
  const phoneId = (await connection.json()).data.id
  expect((await page.request.post(`${API}/templates/sync`, { headers, data: {} })).status()).toBe(
    200,
  )
  const templates = (
    await (
      await page.request.get(`${API}/templates/approved?phoneNumberId=${phoneId}`, { headers })
    ).json()
  ).data
  const template = templates.find((t: { name: string }) => t.name === 'delivery_update')
  const tag = await page.request.post(`${API}/tags`, {
    headers,
    data: { name: 'Delivery customers', color: 'PRIMARY' },
  })
  expect(tag.status(), await tag.text()).toBe(201)
  const tagId = (await tag.json()).data.id
  for (const [i, name] of ['Priya Shah', 'Farah Ali', 'Ravi Kumar'].entries()) {
    const contact = await page.request.post(`${API}/contacts`, {
      headers,
      data: { name, phone: `+91942221100${i}`, tagIds: [tagId] },
    })
    expect(contact.status(), await contact.text()).toBe(201)
  }
  const create = async (name: string, extra: Record<string, unknown> = {}) => {
    const response = await page.request.post(`${API}/campaigns`, {
      headers,
      data: {
        name,
        phoneNumberId: phoneId,
        templateVersionId: template.versionId,
        audience: { include: [{ kind: 'TAGS', tagIds: [tagId], match: 'ANY' }], exclude: [] },
        variableMapping: { body: [{ kind: 'FIELD', field: 'firstName' }] },
        ...extra,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    return (await response.json()).data
  }
  const launch = async (id: string) => {
    const response = await page.request.post(`${API}/campaigns/${id}/launch`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(response.status(), await response.text()).toBe(200)
    return (await response.json()).data
  }
  return { owner, headers, create, launch, template, phoneId, tagId }
}

test('Campaigns prioritize actual scheduled and paused communications over history at four widths', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const env = await campaignEnvironment(page, 'batch2-campaigns')
  const { headers, create, launch } = env
  const scheduled = await create('Tomorrow’s delivery update', {
    scheduleAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  expect((await launch(scheduled.id)).status).toBe('SCHEDULED')
  const completed = await create('Morning delivery update')
  await launch(completed.id)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/campaigns/${completed.id}`, { headers })).json())
          .data.status,
      { timeout: 60_000 },
    )
    .toBe('COMPLETED')
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${API}/campaigns/${completed.id}/stats`, { headers })
          ).json()
        ).data.read,
      { timeout: 30_000 },
    )
    .toBe(3)
  const paused = await create('Afternoon delivery update', { rateLimitPerMinute: 1 })
  await launch(paused.id)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/campaigns/${paused.id}`, { headers })).json()).data
          .status,
      { timeout: 30_000 },
    )
    .toBe('RUNNING')
  const beforePause = (
    await (await page.request.get(`${API}/campaigns/${paused.id}/recipients`, { headers })).json()
  ).data
  const pause = await page.request.post(`${API}/campaigns/${paused.id}/pause`, { headers })
  expect(pause.status(), await pause.text()).toBe(200)
  await create('Weekend delivery draft')
  await page.goto('/campaigns')
  const active = page.getByRole('region', { name: 'Active campaigns' })
  const history = page.getByRole('table', { name: 'Campaigns', exact: true })
  await expect(active.getByText('Tomorrow’s delivery update', { exact: true })).toBeVisible()
  await expect(active.getByText('Paused by your team.')).toBeVisible()
  await expect(
    history.getByRole('row').filter({ hasText: 'Morning delivery update' }),
  ).toContainText('100%')
  await expect(history).toContainText('Weekend delivery draft')
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`campaigns-${width}.png`), fullPage: true })
  }
  await page.getByRole('tab', { name: 'Drafts', exact: true }).click()
  await expect(history).toContainText('Weekend delivery draft')
  await expect(active).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search campaigns' }).fill('no_matching_campaign')
  await expect(page.getByText('No matching campaigns')).toBeVisible()
  // All snapshotted recipients survive pause; already queued messages may finish normally.
  const afterPause = (
    await (await page.request.get(`${API}/campaigns/${paused.id}/recipients`, { headers })).json()
  ).data
  expect(afterPause.map((r: { id: string }) => r.id).sort()).toEqual(
    beforePause.map((r: { id: string }) => r.id).sort(),
  )
  expect(afterPause).toHaveLength(3)
})

test('Campaign funding/template pause views explain recovery without switching frozen content', async ({
  page,
}) => {
  const env = await campaignEnvironment(page, 'batch2-campaign-pause-views')
  const scheduled = await env.create('Synthetic pause-state review', {
    scheduleAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  const actual = await env.launch(scheduled.id)
  // Read-only presentation fixtures exercise rare operational states without enabling real billing enforcement.
  for (const status of ['PAUSED_INSUFFICIENT_FUNDS', 'PAUSED_TEMPLATE_UNAVAILABLE']) {
    await page.route(/\/api\/v1\/campaigns$/, (route) =>
      route.fulfill({ json: { data: [{ ...actual, status }] } }),
    )
    await page.goto('/campaigns')
    const active = page.getByRole('region', { name: 'Active campaigns' })
    if (status === 'PAUSED_INSUFFICIENT_FUNDS') {
      await expect(active).toContainText(
        'Unsent recipients are waiting; sent results are preserved.',
      )
      await expect(active.getByRole('link', { name: 'Open wallet' })).toHaveAttribute(
        'href',
        '/billing/wallet',
      )
    } else {
      await expect(active).toContainText('same version is sendable')
      await expect(active.getByRole('button', { name: /switch.*template/i })).toHaveCount(0)
    }
    await accessible(page)
    await page.unroute(/\/api\/v1\/campaigns$/)
  }
})

test('Campaign Studio keeps guided steps beside recipient previews at four widths', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const env = await campaignEnvironment(page, 'batch2-studio')
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Preview delivery_update', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'delivery_update' })
    .getByRole('link', { name: 'Use in campaign' })
    .click()
  await page.getByLabel('Campaign name').fill('Tomorrow’s deliveries')
  await page.getByRole('checkbox', { name: 'Delivery customers', exact: true }).first().click()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('combobox', { name: 'Approved template' })).toContainText(
    'delivery_update',
  )
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.getByRole('combobox', { name: 'Message {{1}}: value' }).click()
  await page.getByRole('option', { name: 'First name', exact: true }).click()
  const draftId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.route(`**/api/v1/campaigns/${draftId}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAVAILABLE', message: 'Draft save temporarily unavailable' },
          }),
        })
      : route.continue(),
  )
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Draft couldn’t be saved' }),
  ).toContainText('Draft save temporarily unavailable')
  await expect(page.getByRole('combobox', { name: 'Message {{1}}: value' })).toContainText(
    'First name',
  )
  await page.unroute(`**/api/v1/campaigns/${draftId}`)
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('radio', { name: /Send now/ })).toBeChecked()
  const preview = page.getByRole('figure', { name: 'Message preview' })
  await expect(preview).toContainText(/Hi (Priya|Farah|Ravi), your delivery/)
  await page.getByRole('combobox', { name: 'Preview recipient' }).click()
  await page.getByRole('option', { name: 'Farah Ali', exact: true }).click()
  await expect(preview).toContainText('Hi Farah, your delivery')
  await page.getByRole('radio', { name: 'Schedule for later' }).click()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel('Date', { exact: true }).fill(tomorrow)
  await page.getByLabel('Time', { exact: true }).fill('')
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'When to send', exact: true })).toBeVisible()
  await page.getByLabel('Time', { exact: true }).fill('09:30')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByText('Will receive it', { exact: true })).toBeVisible()
  await expect(page.getByText('Estimated customer charge:', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Schedule campaign', exact: true })).toBeEnabled()
  const estimateRoute = `**/api/v1/campaigns/${draftId}/estimate`
  await page.route(estimateRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Estimate temporarily unavailable' },
      }),
    }),
  )
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Time', { exact: true }).fill('09:45')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Recipient estimate couldn’t be loaded' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Schedule campaign', exact: true })).toBeDisabled()
  await page.unroute(estimateRoute)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Schedule campaign', exact: true })).toBeEnabled()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`campaign-studio-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Schedule campaign', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Schedule this campaign?' })
  await expect(confirmation).toContainText('3 contacts receive')
  await accessible(page)
  await confirmation.getByRole('button', { name: 'Schedule campaign', exact: true }).click()
  await expect(page.locator('[data-status="SCHEDULED"]').first()).toBeVisible()
  const stored = (
    await (await page.request.get(`${API}/campaigns/${draftId}`, { headers: env.headers })).json()
  ).data
  expect(stored.timezone).toBe('Asia/Kolkata')
  expect(new Date(stored.scheduleAt).toISOString()).toBe(`${tomorrow}T04:15:00.000Z`)
})

test('Campaign Studio protects unsaved links, browser Back and reload, but saved drafts exit freely', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const env = await campaignEnvironment(page, 'batch2-studio-drafts')
  await page.goto('/onboarding')
  await page.getByLabel('Workspace name').fill('Draft guard workspace')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole('button', { name: /Current workspace: Draft guard workspace/ }).click()
  await page.getByRole('menuitem', { name: /Acme Retail/ }).click()
  await expect(page.getByRole('button', { name: /Current workspace: Acme Retail/ })).toBeVisible()
  await page.goto('/campaigns')
  await page.getByRole('link', { name: 'New campaign', exact: true }).click()
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Exit', exact: true }).click()
  await expect(page).toHaveURL(/\/campaigns$/)
  await page.getByRole('link', { name: 'New campaign', exact: true }).click()
  await page.getByLabel('Campaign name').fill('Retain this draft')
  const dialog = page.getByRole('alertdialog', { name: 'Leave with unsaved changes?' })
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('Contacts')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(/\/campaigns\/new$/)
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  await expect(page.getByLabel('Campaign name')).toBeFocused()
  await page.getByRole('button', { name: /Current workspace: Acme Retail/ }).click()
  await page.getByRole('menuitem', { name: /Draft guard workspace/ }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByRole('button', { name: /Current workspace: Acme Retail/ })).toBeVisible()
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  await page.getByRole('button', { name: /Current workspace: Acme Retail/ }).click()
  await page.getByRole('menuitem', { name: 'Create workspace', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(/\/campaigns\/new$/)
  await page.getByRole('link', { name: 'Exit', exact: true }).click()
  await expect(dialog).toBeVisible()
  await accessible(page)
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByRole('link', { name: 'Exit', exact: true })).toBeFocused()
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  const back = page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => null)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await back
  await expect(page).toHaveURL(/\/campaigns\/new$/)
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  let reloadProtected = false
  page.once('dialog', async (native) => {
    reloadProtected = native.type() === 'beforeunload'
    await native.dismiss()
  })
  await page.reload({ timeout: 5000 }).catch(() => undefined)
  expect(reloadProtected).toBe(true)
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved', { exact: true }).first()).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  await expect(page.getByLabel('Campaign name')).toHaveValue('Retain this draft')
  await expect(page.getByRole('button', { name: 'Audience', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  )
  await page.getByRole('link', { name: 'Exit', exact: true }).click()
  await expect(page).toHaveURL(/\/campaigns$/)
  await expect(dialog).toHaveCount(0)
  const stored = (
    await (await page.request.get(`${API}/campaigns/${id}`, { headers: env.headers })).json()
  ).data
  expect(stored.name).toBe('Retain this draft')
  expect(stored.status).toBe('DRAFT')
  await page.goto(`/campaigns/${id}`)
  await page.getByLabel('Campaign name').fill('Discard this unsaved rename')
  await page.getByRole('link', { name: 'Exit', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/campaigns$/)
  const afterDiscard = (
    await (await page.request.get(`${API}/campaigns/${id}`, { headers: env.headers })).json()
  ).data
  expect(afterDiscard.name).toBe('Retain this draft')
  await page.goto(`/campaigns/${id}`)
  await page.getByLabel('Campaign name').fill('Discard when switching workspace')
  await page.getByRole('button', { name: /Current workspace: Acme Retail/ }).click()
  await page.getByRole('menuitem', { name: /Draft guard workspace/ }).click()
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(
    page.getByRole('button', { name: /Current workspace: Draft guard workspace/ }),
  ).toBeVisible()
  const afterSwitch = (
    await (await page.request.get(`${API}/campaigns/${id}`, { headers: env.headers })).json()
  ).data
  expect(afterSwitch.name).toBe('Retain this draft')
})

test('Campaign Studio retries a lost launch response with the same idempotency key', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const env = await campaignEnvironment(page, 'batch2-studio-launch-retry')
  const draft = await env.create('Safe launch retry', {
    scheduleAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  await page.goto(`/campaigns/${draft.id}`)
  for (let step = 0; step < 4; step++)
    await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('button', { name: 'Schedule campaign', exact: true })).toBeEnabled()
  const keys: string[] = []
  await page.route(`**/api/v1/campaigns/${draft.id}/launch`, async (route) => {
    keys.push(route.request().headers()['idempotency-key']!)
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    if (keys.length === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAVAILABLE', message: 'Launch response unavailable' },
        }),
      })
    else await route.fulfill({ response })
  })
  const launch = async () => {
    await page.getByRole('button', { name: 'Schedule campaign', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Schedule this campaign?' })
      .getByRole('button', { name: 'Schedule campaign', exact: true })
      .click()
  }
  await launch()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Launch couldn’t be confirmed' }),
  ).toContainText('Retry uses the same launch reference.')
  expect(
    (
      await (
        await page.request.get(`${API}/campaigns/${draft.id}`, { headers: env.headers })
      ).json()
    ).data.status,
  ).toBe('SCHEDULED')
  await launch()
  await expect(page.locator('[data-status="SCHEDULED"]').first()).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
})

test('Batch 2 primary routes meet the Lighthouse accessibility gate', async ({ page }) => {
  test.skip(
    process.env.EV2_BATCH2_LIGHTHOUSE !== 'true',
    'Set EV2_BATCH2_LIGHTHOUSE=true for the explicit checkpoint audit',
  )
  test.setTimeout(300_000)
  const env = await campaignEnvironment(page, 'batch2-lighthouse')
  const draft = await env.create('Accessibility campaign draft')
  const scheduled = await env.create('Accessibility scheduled campaign', {
    scheduleAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  await env.launch(scheduled.id)
  const directory = resolve(__dirname, '../test-results/experience-v2-batch-2-lighthouse')
  mkdirSync(directory, { recursive: true })
  const profile = resolve(directory, 'chrome-profile')
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--remote-debugging-port=9336', '--remote-debugging-address=127.0.0.1'],
  })
  const scores: Array<{ path: string; score: number; failing: string[] }> = []
  try {
    await context.addCookies(await page.context().cookies())
    for (const path of [
      '/contacts',
      '/templates',
      '/campaigns',
      '/campaigns/new',
      `/campaigns/${draft.id}`,
    ]) {
      const output = resolve(directory, 'result.json')
      const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
      await promisify(execFile)(
        'pnpm',
        [
          'dlx',
          'lighthouse@12.8.2',
          `${base}${path}`,
          '--port=9336',
          '--only-categories=accessibility',
          '--output=json',
          `--output-path=${output}`,
          '--quiet',
          '--disable-storage-reset',
        ],
        { cwd: resolve(__dirname, '../../..'), timeout: 60_000 },
      )
      const report = JSON.parse(readFileSync(output, 'utf8'))
      expect(new URL(report.finalDisplayedUrl).pathname).toBe(new URL(`${base}${path}`).pathname)
      const score = report.categories.accessibility.score * 100
      const failing = Object.entries(report.audits)
        .filter(([, audit]) => (audit as { score: number | null }).score === 0)
        .map(([id]) => id)
      scores.push({
        path: path === `/campaigns/${draft.id}` ? '/campaigns/:id (draft)' : path,
        score,
        failing,
      })
      expect(score, path).toBeGreaterThanOrEqual(95)
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
})
