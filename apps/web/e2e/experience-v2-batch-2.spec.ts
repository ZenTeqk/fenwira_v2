import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
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
  await expect(page.getByText('2 contacts', { exact: true })).toBeVisible()
  const table = page.getByRole('table', { name: 'Contacts', exact: true })
  await expect(table.getByText('Marketing allowed')).toBeVisible()
  await expect(table.getByText('Marketing restricted')).toBeVisible()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true })
    const trigger = table.getByRole('button', { name: 'Priya Shah', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Priya Shah', exact: true })
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
  await expect(page.getByRole('dialog', { name: 'Priya Shah', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Farah Ali', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Farah Ali' })
  await expect(drawer.getByRole('alert')).toContainText('Eligibility couldn’t be loaded')
  await page.unroute('**/api/v1/contacts/*/eligibility')
  await drawer.getByRole('button', { name: 'Try again' }).click()
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
