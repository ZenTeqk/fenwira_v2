import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { API, metaId, MOCK, ownerHeaders, signInAsNewOwner } from './support'

// Light-mode review of Contacts, Templates and Campaigns. Every record is created through the
// domain APIs and the Meta mock; MODULE_SHOTS_DIR saves review screenshots.
const shots = process.env.MODULE_SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForLoadState('networkidle')
  if (shots)
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage, animations: 'disabled' })
}
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
const noPageOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)

const LONG_NAME = 'Venkatasubramanian Krishnamoorthy Raghavachari'

async function seedWorkspace(page: Page) {
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  const headers = ownerHeaders(owner)
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  const imported = await fetch(`${MOCK}/__mock/templates`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      add: [
        {
          name: 'delivery_update',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'Your requested delivery update is ready.' }],
        },
        {
          name: 'order_ready_for_pickup',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Order update' },
            {
              type: 'BODY',
              text: 'Hi {{1}}, your order is ready for pickup at our Nagercoil store. Bring this message to the counter.',
              example: { body_text: [['Priya']] },
            },
            { type: 'FOOTER', text: 'Acme Electronics · Reply STOP to opt out' },
            {
              type: 'BUTTONS',
              buttons: [
                { type: 'QUICK_REPLY', text: 'Confirm pickup' },
                { type: 'QUICK_REPLY', text: 'Change time' },
              ],
            },
          ],
        },
        {
          name: 'festive_offer',
          language: 'en',
          category: 'MARKETING',
          status: 'APPROVED',
          components: [
            { type: 'BODY', text: 'Our festive collection is here. Visit us this week.' },
          ],
        },
        {
          name: 'diwali_flash_sale_announcement_for_all_loyal_customers_2026',
          language: 'en',
          category: 'MARKETING',
          status: 'REJECTED',
          rejected_reason: 'INVALID_FORMAT',
          components: [{ type: 'BODY', text: 'Flash sale!!! Everything 90% off today only.' }],
        },
        {
          name: 'login_code',
          language: 'en',
          category: 'AUTHENTICATION',
          status: 'PENDING',
          components: [
            {
              type: 'BODY',
              text: '{{1}} is your verification code.',
              example: { body_text: [['482913']] },
            },
          ],
        },
      ],
    }),
  })
  expect(imported.ok, await imported.text()).toBe(true)
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers,
  })
  expect(connected.status(), await connected.text()).toBe(201)
  const connectionId = (await connected.json()).data.id as string
  const sync = await page.request.post(`${API}/templates/sync`, { headers, data: {} })
  expect(sync.ok(), await sync.text()).toBe(true)

  const tags: Record<string, string> = {}
  for (const [name, color] of [
    ['VIP', 'PRIMARY'],
    ['Wholesale', 'INFO'],
    ['Follow-up', 'WARNING'],
  ] as const) {
    const tag = await page.request.post(`${API}/tags`, { headers, data: { name, color } })
    expect(tag.status(), await tag.text()).toBe(201)
    tags[name] = (await tag.json()).data.id
  }
  const contactIds: string[] = []
  for (const [i, [name, tagNames, email]] of (
    [
      ['Priya Sharma', ['VIP'], 'priya.sharma@example.com'],
      [LONG_NAME, ['Wholesale', 'Follow-up'], 'venkat.raghavachari.procurement@example.com'],
      ['Asha Rao', ['VIP'], null],
      ['Ravi Kumar', [], null],
      ['Farah Ali', ['Wholesale'], null],
      ['Kumar Stores', ['Wholesale'], null],
    ] as const
  ).entries()) {
    const created = await page.request.post(`${API}/contacts`, {
      headers,
      data: {
        name,
        phone: `+9194222${String(i).padStart(2, '0')}${metaId().slice(-3)}`,
        ...(email ? { email } : {}),
        tagIds: tagNames.map((t) => tags[t]),
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    contactIds.push((await created.json()).data.id)
  }
  const note = await page.request.post(`${API}/contacts/${contactIds[0]}/notes`, {
    headers,
    data: { body: 'Prefers weekend deliveries. Ask before sending festive offers.' },
  })
  expect(note.status(), await note.text()).toBe(201)

  const templates = (await (await page.request.get(`${API}/templates`, { headers })).json())
    .data as Array<{ id: string; name: string; wabaId: string }>
  const draft = await page.request.post(`${API}/templates`, {
    headers,
    data: {
      wabaId: templates[0]!.wabaId,
      name: 'shipping_delay_notice',
      language: 'en',
      category: 'UTILITY',
      components: { body: { text: 'Hi {{1}}, your shipment is delayed by a day.' } },
      samples: { body: ['Priya'] },
    },
  })
  expect(draft.status(), await draft.text()).toBe(201)
  const approved = (
    await (
      await page.request.get(`${API}/templates/approved?phoneNumberId=${connectionId}`, {
        headers,
      })
    ).json()
  ).data as Array<{ name: string; versionId: string }>
  const delivery = approved.find((t) => t.name === 'delivery_update')!

  const campaign = async (name: string, ids: string[], scheduleAt?: string) => {
    const created = await page.request.post(`${API}/campaigns`, {
      headers,
      data: {
        name,
        phoneNumberId: connectionId,
        templateVersionId: delivery.versionId,
        audience: { include: [{ kind: 'CONTACTS', contactIds: ids }], exclude: [] },
        variableMapping: { body: [] },
        rateLimitPerMinute: 60,
        ...(scheduleAt ? { scheduleAt } : {}),
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    return (await created.json()).data.id as string
  }
  const status = async (id: string) =>
    (await (await page.request.get(`${API}/campaigns/${id}`, { headers })).json()).data.status
  const launch = async (id: string) => {
    const res = await page.request.post(`${API}/campaigns/${id}/launch`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(res.ok(), await res.text()).toBe(true)
  }

  await campaign('Weekend pickup reminder (draft)', contactIds.slice(0, 2))
  const scheduled = await campaign(
    'Festival week delivery schedule for all wholesale partners in Tamil Nadu',
    contactIds.slice(1, 4),
    new Date(Date.now() + 3 * 86400000).toISOString(),
  )
  await launch(scheduled)
  const sent = await campaign('Delivery update · October', contactIds.slice(0, 3))
  await launch(sent)
  const paused = await campaign('Store timing change', contactIds.slice(2, 6))
  await launch(paused)
  await expect.poll(() => status(paused), { timeout: 30_000 }).not.toBe('PREPARING')
  await page.request.post(`${API}/campaigns/${paused}/pause`, { headers })
  // Let the small sent campaign finish when the local pacing allows; otherwise it shows running.
  await expect.poll(() => status(sent), { timeout: 45_000 }).toMatch(/COMPLETED|RUNNING/)
  return { headers, contactIds, templates, sentCampaign: sent, scheduledCampaign: scheduled }
}

test.describe.configure({ mode: 'serial' })

test('Contacts: directory, selection, detail, create dialog, import, segments and tags', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const seed = await seedWorkspace(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/contacts')
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  await expect(page.getByText(LONG_NAME).first()).toBeVisible()
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'contacts-1440')
  // Selection (bulk actions) and an inspected contact.
  const rows = page.getByRole('row')
  await rows.nth(2).getByRole('checkbox').check()
  await rows.nth(3).hover()
  await shot(page, 'contacts-1440-selection')
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `contacts-${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/contacts/${seed.contactIds[1]}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Venkatasubramanian')
  await axe(page)
  await shot(page, 'contact-detail-1440', true)
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'contact-detail-375', true)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Add contact' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Create contact' }).click()
  await axe(page)
  await shot(page, 'contacts-create-dialog-validation-1440')
  await page.keyboard.press('Escape')

  await page.goto('/contacts/imports')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shot(page, 'contacts-imports-1440')
  await page.getByRole('button', { name: 'Import contacts' }).click()
  const wizard = page.getByRole('dialog', { name: 'Import contacts' })
  await wizard.getByLabel('CSV file').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Phone,Name,Tags\n9833300001,Arjun,vip\n12345,Broken,\n9833300002,Divya,vip;new\n',
    ),
  })
  await expect(wizard.getByRole('table', { name: 'Column mapping' })).toBeVisible({
    timeout: 20_000,
  })
  await shot(page, 'contacts-import-mapping-1440')
  await wizard.getByRole('button', { name: 'Check rows' }).click()
  await expect(wizard.getByText('2 of 3 rows are ready')).toBeVisible({ timeout: 20_000 })
  await axe(page)
  await shot(page, 'contacts-import-validation-1440')
  await wizard.getByRole('button', { name: 'Import 2 contacts' }).click()
  await expect(wizard.getByText(/2 created/)).toBeVisible({ timeout: 20_000 })
  await shot(page, 'contacts-import-result-1440')
  await page.keyboard.press('Escape')

  for (const path of ['segments', 'tags']) {
    await page.goto(`/contacts/${path}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await axe(page)
    await shot(page, `contacts-${path}-1440`)
  }
})

test('Templates: library, statuses, detail, rejection, editor and preview', async ({ page }) => {
  test.setTimeout(180_000)
  const seed = await seedWorkspace(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/templates')
  await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
  await expect(page.getByText('order_ready_for_pickup').first()).toBeVisible()
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'templates-1440', true)
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `templates-${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Preview order_ready_for_pickup' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot(page, 'templates-preview-sheet-1440')
  await page.keyboard.press('Escape')

  const byName = (name: string) => seed.templates.find((t) => t.name === name)!
  for (const [name, file] of [
    ['order_ready_for_pickup', 'template-detail-approved-1440'],
    [
      'diwali_flash_sale_announcement_for_all_loyal_customers_2026',
      'template-detail-rejected-1440',
    ],
    ['login_code', 'template-detail-pending-1440'],
  ] as const) {
    await page.goto(`/templates/${byName(name).id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await axe(page)
    await shot(page, file, true)
  }
  await page.goto('/templates/new')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await axe(page)
  await shot(page, 'template-editor-1440', true)
  await page.setViewportSize({ width: 768, height: 900 })
  await noPageOverflow(page)
  await shot(page, 'template-editor-768', true)
})

test('Campaigns: operations, detail, wizard steps and launch confirmation', async ({ page }) => {
  test.setTimeout(180_000)
  const seed = await seedWorkspace(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/campaigns')
  await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible()
  await noPageOverflow(page)
  await axe(page)
  await shot(page, 'campaigns-1440', true)
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await noPageOverflow(page)
    await shot(page, `campaigns-${width}`, width === 375)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [id, file] of [
    [seed.sentCampaign, 'campaign-detail-sent-1440'],
    [seed.scheduledCampaign, 'campaign-detail-scheduled-1440'],
  ] as const) {
    await page.goto(`/campaigns/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await axe(page)
    await shot(page, file, true)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'campaign-detail-sent-375', true)

  // Wizard: audience → template → personalize → schedule → review → launch confirmation (cancelled).
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/campaigns/new')
  await page.getByLabel('Campaign name').fill('Pickup reminder for VIP customers')
  await page.getByRole('checkbox', { name: /VIP/ }).first().click()
  await axe(page)
  await shot(page, 'campaign-wizard-audience-1440')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.getByRole('combobox', { name: 'Approved template' }).click()
  await page.getByRole('option', { name: /order_ready_for_pickup/ }).click()
  await expect(page.getByRole('figure', { name: 'Message preview' }).first()).toBeVisible()
  await shot(page, 'campaign-wizard-template-1440')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.getByRole('combobox', { name: 'Message {{1}}: value' }).click()
  await page.getByRole('option', { name: 'First name' }).click()
  await shot(page, 'campaign-wizard-personalize-1440')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('radio', { name: /Send now/ })).toBeChecked()
  await shot(page, 'campaign-wizard-schedule-1440')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByText('Will receive it')).toBeVisible({ timeout: 20_000 })
  await axe(page)
  await shot(page, 'campaign-wizard-review-1440')
  await page.setViewportSize({ width: 375, height: 812 })
  await noPageOverflow(page)
  await shot(page, 'campaign-wizard-review-375')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Launch campaign' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Launch this campaign now?' })
  await expect(confirm).toBeVisible()
  await shot(page, 'campaign-launch-confirm-1440')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
})
