import { expect, type Page } from '@playwright/test'
import { type Conversation, type WhatsAppConnection } from '@fenwira/contracts'
import {
  API,
  MOCK,
  customerWritesIn,
  metaId,
  type Owner,
  ownerHeaders,
  refreshCsrf,
  signInAsNewOwner,
} from './support'

export type InboxFixture = {
  owner: Owner
  conversation: Conversation
  connection: WhatsAppConnection
  /** Current owner headers (refreshes the CSRF token first). */
  headers: () => Promise<Record<string, string>>
}

/** A customer message through the meta-mock (a real inbound webhook). */
export async function inbound(phoneNumberId: string, from: string, name: string, text: string) {
  const res = await fetch(`${MOCK}/__mock/inbound`, {
    method: 'POST',
    body: JSON.stringify({ phoneNumberId, from, name, text }),
  })
  expect(res.ok).toBe(true)
}

/**
 * A workspace with one rich conversation (named contact, tags, contact note, agent replies, a
 * follow-up, an internal note, assigned to the owner) and several other conversations. Everything
 * goes through the domain APIs, so the inbox reads real server data.
 */
export async function seedInbox(page: Page, label = 'Arun'): Promise<InboxFixture> {
  const owner = await signInAsNewOwner(page, label, 'Acme Electronics')
  const headers = async () => {
    await refreshCsrf(page, owner)
    return ownerHeaders(owner)
  }
  const customer = await customerWritesIn(
    page,
    owner,
    'Do you have the 55-inch model? Can you share the price?',
  )
  let conversation!: Conversation
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`${API}/conversations?view=all`, { headers: await headers() })
      ).json()
      conversation = body.data.find((c: Conversation) => c.contact.waProfileName === customer)
      return Boolean(conversation)
    })
    .toBe(true)
  const connections = (
    await (
      await page.request.get(`${API}/whatsapp/connections`, { headers: await headers() })
    ).json()
  ).data as WhatsAppConnection[]
  const connection = connections.find((c) => c.id === conversation.phoneNumber.id)!

  const renamed = await page.request.patch(`${API}/contacts/${conversation.contact.id}`, {
    headers: await headers(),
    data: { name: 'Priya Sharma' },
  })
  expect(renamed.status(), await renamed.text()).toBe(200)
  for (const [name, color] of [
    ['New customer', 'PRIMARY'],
    ['Television', 'INFO'],
  ] as const) {
    const tag = await page.request.post(`${API}/tags`, {
      headers: await headers(),
      data: { name, color },
    })
    expect(tag.status(), await tag.text()).toBe(201)
    const tagId = (await tag.json()).data.id
    expect(
      (
        await page.request.put(`${API}/conversations/${conversation.id}/tags/${tagId}`, {
          headers: await headers(),
          data: {},
        })
      ).ok(),
    ).toBe(true)
    expect(
      (
        await page.request.post(`${API}/contacts/bulk`, {
          headers: await headers(),
          data: { action: 'TAG', contactIds: [conversation.contact.id], tagId },
        })
      ).ok(),
    ).toBe(true)
  }
  const contactNote = await page.request.post(`${API}/contacts/${conversation.contact.id}/notes`, {
    headers: await headers(),
    data: { body: 'Asked about television availability. Follow up after confirming stock.' },
  })
  expect(contactNote.status(), await contactNote.text()).toBe(201)

  for (const [i, [name, text]] of [
    ['ABC Electronics', 'Thank you. Can you confirm delivery tomorrow?'],
    ['Kumar Stores', 'Please share your catalogue.'],
    ['Anita Rao', 'Is this available in Nagercoil?'],
    ['Suresh Kumar', 'What is the warranty on this model?'],
    ['Lakshmi Traders', 'Can you send the catalogue?'],
    ['Mohan Raj', 'Can you arrange installation?'],
  ].entries())
    await inbound(connection.phoneNumberId, `9194998800${i}${metaId().slice(-1)}`, name, text)

  for (const text of [
    'Hi Priya! I’ll check availability and send the details shortly.',
    'The 55-inch model is in stock. You can compare the available models in our catalogue, and I’ll confirm the price before you visit.',
  ]) {
    const sent = await page.request.post(`${API}/conversations/${conversation.id}/messages`, {
      headers: { ...(await headers()), 'Idempotency-Key': `e2e-${metaId()}` },
      data: { content: { type: 'TEXT', text } },
    })
    expect(sent.status(), await sent.text()).toBe(201)
  }
  await inbound(
    connection.phoneNumberId,
    conversation.contact.phoneE164.replace(/^\+/, ''),
    'Priya Sharma',
    'Could you confirm whether delivery is available tomorrow?',
  )
  const note = await page.request.post(`${API}/conversations/${conversation.id}/notes`, {
    headers: await headers(),
    data: { body: 'Interested in the 55-inch model. Confirm stock before following up.' },
  })
  expect(note.status(), await note.text()).toBe(201)
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).data
  const assigned = await page.request.post(`${API}/conversations/${conversation.id}/assign`, {
    headers: await headers(),
    data: { assigneeId: me.user.id },
  })
  expect(assigned.ok()).toBe(true)
  return { owner, conversation, connection, headers }
}

const mockControl = (action: string, body: unknown) =>
  fetch(`${MOCK}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

/**
 * The review scenario (docs/INBOX.md → Layout): a customer with a long name whose reply window
 * closed two days ago, a long message, an approved template with a header and buttons, a template
 * that failed, a private note and paused automation; plus other customers with unread messages.
 */
export async function seedReviewInbox(page: Page): Promise<InboxFixture> {
  const owner = await signInAsNewOwner(page, 'Review', 'Zenteqk Internal')
  const headers = async () => {
    await refreshCsrf(page, owner)
    return ownerHeaders(owner)
  }
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await mockControl('seed', { wabaId, phones: [{ id: phoneNumberId }] })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers: await headers(),
  })
  expect(connected.status(), await connected.text()).toBe(201)

  // Two days ago: the customer wrote twice, so the 24-hour window has closed.
  const from = `9197519${String(Math.random()).slice(2, 7)}`
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 50 * 3600
  for (const [i, text] of [
    'Hi, can you share the details?',
    'I wanted to know about the pricing for the 55-inch television, whether installation is included, and if you deliver to Nagercoil on weekends. My brother bought one from you last year and said the service was very good, so I would like to order the same model if it is still available.',
  ].entries()) {
    const res = await mockControl('inbound', {
      phoneNumberId,
      from,
      name: 'Venkatasubramanian Krishnamoorthy',
      text,
      timestamp: twoDaysAgo + i * 60,
    })
    expect(res.ok).toBe(true)
  }
  let conversation!: Conversation
  let wabaRowId = ''
  await expect(async () => {
    const body = await (
      await page.request.get(`${API}/conversations?limit=100`, { headers: await headers() })
    ).json()
    conversation = body.data.find((c: Conversation) => c.contact.phoneE164 === `+${from}`)
    expect(conversation).toBeTruthy()
    const templates = await page.request.get(`${API}/templates?q=hello_world`, {
      headers: await headers(),
    })
    wabaRowId = ((await templates.json()) as { data: Array<{ wabaId: string }> }).data[0]!.wabaId
    expect(wabaRowId).toBeTruthy()
  }).toPass({ timeout: 20_000 })
  const renamed = await page.request.patch(`${API}/contacts/${conversation.contact.id}`, {
    headers: await headers(),
    data: { name: 'Venkatasubramanian Krishnamoorthy Raghavachari' },
  })
  expect(renamed.status(), await renamed.text()).toBe(200)

  // An approved utility template with a header, footer and buttons.
  const name = `order_update_${metaId().slice(-4)}`
  const created = await page.request.post(`${API}/templates`, {
    headers: await headers(),
    data: {
      wabaId: wabaRowId,
      name,
      language: 'en',
      category: 'UTILITY',
      components: {
        header: { format: 'TEXT', text: 'Order {{1}} update' },
        body: {
          text: 'Hi {{1}}, thank you for your enquiry. The 55-inch model is available at our Nagercoil store and installation is included.\nReply to this message or call us to confirm your delivery slot.',
        },
        footer: { text: 'Acme Electronics · Reply STOP to opt out' },
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirm delivery' },
          { type: 'PHONE_NUMBER', text: 'Call the store', phoneE164: '+919876543210' },
        ],
      },
      samples: { header: ['#1042'], body: ['Venkat'] },
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const templateId = (await created.json()).data.id
  const submitted = await page.request.post(`${API}/templates/${templateId}/submit`, {
    headers: { ...(await headers()), 'Idempotency-Key': `sub-${metaId()}` },
  })
  expect(submitted.status(), await submitted.text()).toBe(200)
  let versionId = ''
  await expect(async () => {
    const t = (
      await (
        await page.request.get(`${API}/templates/${templateId}`, { headers: await headers() })
      ).json()
    ).data
    expect(t.status).toBe('APPROVED')
    versionId = t.currentVersion.id
  }).toPass({ timeout: 20_000 })

  const sendTemplate = async () => {
    const res = await page.request.post(`${API}/conversations/${conversation.id}/messages`, {
      headers: { ...(await headers()), 'Idempotency-Key': `e2e-${metaId()}` },
      data: {
        content: {
          type: 'TEMPLATE',
          templateVersionId: versionId,
          variables: { header: ['#1042'], body: ['Venkat'] },
        },
      },
    })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()).data.id as string
  }
  // The first is delivered and read (the mock's automatic statuses).
  await sendTemplate()
  // The second fails: statuses only when posted here, then Meta reports it undeliverable.
  await mockControl('auto-statuses', { statuses: [] })
  try {
    const failing = await sendTemplate()
    let wamid = ''
    await expect(async () => {
      const m = (
        await (
          await page.request.get(`${API}/messages/${failing}`, { headers: await headers() })
        ).json()
      ).data
      expect(m.providerMessageId).toBeTruthy()
      wamid = m.providerMessageId
    }).toPass({ timeout: 20_000 })
    await mockControl('status', { wamid, status: 'failed', errorCode: 131026 })
  } finally {
    await mockControl('auto-statuses', {})
  }

  const note = await page.request.post(`${API}/conversations/${conversation.id}/notes`, {
    headers: await headers(),
    data: { body: 'Asked about delivery to Nagercoil. Call before 6 pm to confirm the slot.' },
  })
  expect(note.status(), await note.text()).toBe(201)
  const paused = await page.request.post(
    `${API}/conversations/${conversation.id}/automation-state`,
    { headers: await headers(), data: { state: 'AUTOMATION_PAUSED' } },
  )
  expect(paused.ok(), await paused.text()).toBe(true)

  // Other customers, some with more than one unread message.
  for (const [i, [who, texts]] of (
    [
      ['Asha Rao', ['Hello!', 'Please share the details.']],
      ['Vikram Iyer', ['It shipped yesterday and will reach you by Friday, right?']],
      ['Rahul Verma', ['What are your store timings?']],
      ['Fatima Shaikh', ['Yes, for orders under ₹5,000.', 'Do you offer EMI?', 'Thanks']],
      ['Priya Nair', ['Can you confirm availability?']],
    ] as const
  ).entries()) {
    const phone = `9194997700${i}${String(Math.random()).slice(2, 4)}`
    for (const text of texts) await inbound(phoneNumberId, phone, who, text)
  }

  const connection = (
    (
      await (
        await page.request.get(`${API}/whatsapp/connections`, { headers: await headers() })
      ).json()
    ).data as WhatsAppConnection[]
  ).find((c) => c.phoneNumberId === phoneNumberId)!
  return { owner, conversation, connection, headers }
}
