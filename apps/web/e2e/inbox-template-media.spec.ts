import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import {
  API,
  metaId,
  MOCK,
  type Owner,
  ownerHeaders,
  resetRateLimits,
  signInAsNewOwner,
} from './support'

/**
 * Inbox template content, media filter chips and WhatsApp-style ticks (docs/INBOX.md → Template
 * messages, Media filter; docs/MESSAGING_ENGINE.md → Status ticks), against the meta-mock.
 */
test.beforeEach(() => resetRateLimits())

const mock = (action: string, body: unknown) =>
  fetch(`${MOCK}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

type Thread = { conversationId: string; customer: string; wabaRowId: string }

/** A fresh simulated number, synced templates, and a customer who wrote in (window open). */
async function openConversation(page: Page, owner: Owner, text: string): Promise<Thread> {
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await mock('seed', { wabaId, phones: [{ id: phoneNumberId }] })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers: ownerHeaders(owner),
  })
  expect(connected.status(), await connected.text()).toBe(201)
  const customer = `Customer ${metaId().slice(-4)}`
  const res = await mock('inbound', {
    phoneNumberId,
    from: `9195${String(Math.random()).slice(2, 10)}`,
    name: customer,
    text,
  })
  expect(res.ok).toBe(true)
  let conversationId = ''
  let wabaRowId = ''
  await expect(async () => {
    const list = await page.request.get(`${API}/conversations`, { headers: ownerHeaders(owner) })
    const found = (
      (await list.json()) as { data: Array<{ id: string; contact: { waProfileName: string } }> }
    ).data.find((c) => c.contact.waProfileName === customer)
    expect(found).toBeTruthy()
    conversationId = found!.id
    const templates = await page.request.get(`${API}/templates?q=hello_world`, {
      headers: ownerHeaders(owner),
    })
    wabaRowId = ((await templates.json()) as { data: Array<{ wabaId: string }> }).data[0]!.wabaId
    expect(wabaRowId).toBeTruthy()
  }).toPass({ timeout: 15_000 })
  return { conversationId, customer, wabaRowId }
}

async function send(page: Page, owner: Owner, conversationId: string, content: unknown) {
  const res = await page.request.post(`${API}/conversations/${conversationId}/messages`, {
    data: { content },
    headers: { ...ownerHeaders(owner), 'Idempotency-Key': `e2e-${metaId()}` },
  })
  expect(res.status(), await res.text()).toBe(201)
  return ((await res.json()) as { data: { id: string } }).data.id
}

async function wamidOf(page: Page, owner: Owner, messageId: string): Promise<string> {
  let wamid = ''
  await expect(async () => {
    const res = await page.request.get(`${API}/messages/${messageId}`, {
      headers: ownerHeaders(owner),
    })
    wamid = ((await res.json()) as { data: { providerMessageId: string | null } }).data
      .providerMessageId!
    expect(wamid).toBeTruthy()
  }).toPass({ timeout: 15_000 })
  return wamid
}

async function upload(
  page: Page,
  owner: Owner,
  file: { mime: string; name: string; bytes: Buffer },
) {
  const up = await page.request.post(`${API}/files/upload-url`, {
    data: {
      purpose: 'MESSAGE_MEDIA',
      mimeType: file.mime,
      sizeBytes: file.bytes.length,
      filename: file.name,
    },
    headers: ownerHeaders(owner),
  })
  expect(up.status(), await up.text()).toBe(201)
  const { fileId, url, headers } = (
    (await up.json()) as {
      data: { fileId: string; url: string; headers: Record<string, string> }
    }
  ).data
  const put = await fetch(url, { method: 'PUT', headers, body: file.bytes })
  expect(put.ok).toBe(true)
  const done = await page.request.post(`${API}/files/${fileId}/complete`, {
    headers: ownerHeaders(owner),
  })
  expect(done.status(), await done.text()).toBe(200)
  return fileId
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

const axeClean = async (page: Page) => {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  )
}

test('a template shows its full content, and ticks change live as Meta reports status', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-ticks')
  const thread = await openConversation(page, owner, 'Can I get my voucher?')
  // Statuses only when the test posts them.
  await mock('auto-statuses', { statuses: [] })
  try {
    const name = `voucher_${metaId().slice(-6)}`
    const created = await page.request.post(`${API}/templates`, {
      data: {
        wabaId: thread.wabaRowId,
        name,
        language: 'en',
        category: 'UTILITY',
        components: {
          header: { format: 'TEXT', text: 'Hello {{1}}' },
          body: {
            text: 'Hi {{1}}, your voucher {{2}} is ready.\nShow it at the counter before Friday.',
          },
          footer: { text: 'Reply STOP to opt out' },
          buttons: [
            { type: 'QUICK_REPLY', text: 'Not now' },
            { type: 'URL', text: 'Open voucher', url: 'https://shop.example/v/{{1}}' },
            { type: 'PHONE_NUMBER', text: 'Call us', phoneE164: '+919876543210' },
          ],
        },
        samples: { header: ['Asha'], body: ['Asha', 'V-1'], buttons: { '1': ['V-1'] } },
      },
      headers: ownerHeaders(owner),
    })
    expect(created.status(), await created.text()).toBe(201)
    const templateId = ((await created.json()) as { data: { id: string } }).data.id
    const submitted = await page.request.post(`${API}/templates/${templateId}/submit`, {
      headers: { ...ownerHeaders(owner), 'Idempotency-Key': `sub-${metaId()}` },
    })
    expect(submitted.status(), await submitted.text()).toBe(200)
    let versionId = ''
    await expect(async () => {
      const t = await page.request.get(`${API}/templates/${templateId}`, {
        headers: ownerHeaders(owner),
      })
      const data = (
        (await t.json()) as {
          data: { status: string; currentVersion: { id: string } }
        }
      ).data
      expect(data.status).toBe('APPROVED')
      versionId = data.currentVersion.id
    }).toPass({ timeout: 15_000 })

    await page.goto(`/inbox?c=${thread.conversationId}`)
    const log = page.getByRole('log', { name: 'Messages' })
    await expect(log.getByText('Can I get my voucher?')).toBeVisible()

    const templateMessage = await send(page, owner, thread.conversationId, {
      type: 'TEMPLATE',
      templateVersionId: versionId,
      variables: { header: ['Ravi'], body: ['Ravi', 'V-77'], buttons: { '1': ['V-77'] } },
    })
    // The bubble is named by its label and body, and shows the whole template.
    const bubble = log.getByRole('group', { name: /your voucher V-77 is ready/ })
    await expect(bubble).toBeVisible()
    await expect(bubble.getByText(`Template: ${name}`)).toBeVisible()
    await expect(bubble.getByText('Hello Ravi')).toBeVisible()
    await expect(bubble.getByText('Show it at the counter before Friday.')).toBeVisible()
    await expect(bubble.getByText('Reply STOP to opt out')).toBeVisible()
    const buttons = bubble.getByRole('list', { name: 'Template buttons' })
    await expect(buttons.getByRole('listitem')).toHaveText(['Not now', 'Open voucher', 'Call us'])
    await expect(buttons.getByRole('listitem').nth(1)).toHaveAttribute(
      'title',
      'https://shop.example/v/V-77',
    )
    // Template buttons are display-only: nothing in them can take focus.
    expect(
      await buttons.evaluate(
        (el) => el.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])').length,
      ),
    ).toBe(0)

    // Ticks: icon only, no status text; they follow Meta's webhooks without a refresh.
    await expect(bubble.getByRole('img', { name: 'Sent' })).toBeVisible()
    await expect(bubble.getByText(/^(Sent|Delivered|Read)$/)).toHaveCount(0)
    const wamid = await wamidOf(page, owner, templateMessage)
    await mock('status', { wamid, status: 'delivered' })
    await expect(bubble.getByRole('img', { name: 'Delivered' })).toBeVisible()
    await mock('status', { wamid, status: 'sent' }) // stale: never goes back
    await mock('status', { wamid, status: 'read' })
    await expect(bubble.getByRole('img', { name: 'Read' })).toBeVisible()
    await expect(bubble.getByRole('img', { name: 'Read' }).locator('svg')).toHaveClass(/text-info/)

    // A failure shows its reason on focus, not by colour alone.
    const failing = await send(page, owner, thread.conversationId, {
      type: 'TEXT',
      text: 'This one will bounce',
    })
    const failedWamid = await wamidOf(page, owner, failing)
    await mock('status', { wamid: failedWamid, status: 'failed', errorCode: 131049 })
    const failedTick = log.getByRole('button', { name: 'Failed to send' })
    await expect(failedTick).toBeVisible()
    await failedTick.focus()
    await expect(page.getByRole('tooltip')).toContainText('Error code 131049')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    // Inbound bubbles never show ticks.
    await expect(
      log.getByText('Can I get my voucher?').locator('xpath=ancestor::div[@data-message-id]'),
    ).not.toContainText(/Sent|Delivered|Read/)

    await axeClean(page)
  } finally {
    await mock('auto-statuses', {})
  }
})

test('media chips filter the thread, counts match, and Jump to message returns to it', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-media')
  const thread = await openConversation(page, owner, 'Please send the photos and the invoice')
  const photoA = await upload(page, owner, { mime: 'image/png', name: 'shelf.png', bytes: PNG })
  const photoB = await upload(page, owner, { mime: 'image/png', name: 'front.png', bytes: PNG })
  const invoice = await upload(page, owner, {
    mime: 'application/pdf',
    name: 'invoice-1042.pdf',
    bytes: PDF,
  })
  const first = await send(page, owner, thread.conversationId, {
    type: 'IMAGE',
    fileId: photoA,
    caption: 'The shelf',
  })
  await send(page, owner, thread.conversationId, { type: 'IMAGE', fileId: photoB })
  await send(page, owner, thread.conversationId, {
    type: 'DOCUMENT',
    fileId: invoice,
    filename: 'invoice-1042.pdf',
  })
  // Push the first photo out of view so jumping has to scroll.
  for (let i = 0; i < 14; i++)
    await send(page, owner, thread.conversationId, { type: 'TEXT', text: `Update ${i + 1}` })

  await page.goto(`/inbox?c=${thread.conversationId}`)
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Update 14')).toBeVisible()
  const chips = page.getByRole('group', { name: 'Show messages' })
  const chip = (label: string) => chips.getByRole('button', { name: new RegExp(`^${label}`) })
  await expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('All')).toHaveText('All 18')
  await expect(chip('Images')).toHaveText('Images 2')
  await expect(chip('Videos')).toHaveText('Videos 0')
  await expect(chip('Documents')).toHaveText('Documents 1')

  // Keyboard: chips are buttons with aria-pressed.
  await chip('Images').focus()
  await page.keyboard.press('Enter')
  await expect(chip('Images')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('All')).toHaveAttribute('aria-pressed', 'false')
  const grid = page.getByRole('list', { name: 'Images' })
  await expect(grid.getByRole('listitem')).toHaveCount(2)
  await axeClean(page)

  await chip('Documents').click()
  const docs = page.getByRole('list', { name: 'Documents' })
  await expect(docs.getByRole('listitem')).toHaveCount(1)
  await expect(docs).toContainText('invoice-1042.pdf')
  await expect(docs).toContainText(/PDF · \d+ B/)

  await chip('Videos').click()
  await expect(page.getByText('No videos in this conversation')).toBeVisible()
  await axeClean(page)
  // The active chip toggles back to All.
  await chip('Videos').click()
  await expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
  await expect(log.getByText('Update 14')).toBeVisible()

  // Jump to the oldest photo: back to All, scrolled to it, focus on it.
  await chip('Images').click()
  await grid.getByRole('listitem').last().getByRole('button', { name: 'Jump to message' }).click()
  await expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
  const target = page.locator(`[data-message-id="${first}"]`)
  await expect(target).toBeInViewport()
  await expect(target).toBeFocused()
  await expect(target).toContainText('The shelf')
})
