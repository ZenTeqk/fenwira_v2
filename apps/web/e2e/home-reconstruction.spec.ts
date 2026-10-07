import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { type Conversation, type WhatsAppConnection } from '@fenwira/contracts'
import { API, MOCK, customerWritesIn, ownerHeaders, signInAsNewOwner } from './support'

/** Review fixtures are persisted through domain APIs; screenshots never replace server reads. */
test('Home reconstruction uses persisted records and reference composition at four widths', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  const headers = ownerHeaders(owner)
  const customer = await customerWritesIn(
    page,
    owner,
    'Do you have the 55-inch model? Can you share the price?',
  )
  let conversation!: Conversation
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`${API}/conversations?view=all`, { headers })
      ).json()
      conversation = body.data.find((c: Conversation) => c.contact.waProfileName === customer)
      return Boolean(conversation)
    })
    .toBe(true)
  const connections = (
    await (await page.request.get(`${API}/whatsapp/connections`, { headers })).json()
  ).data as WhatsAppConnection[]
  const connection = connections.find((c) => c.id === conversation.phoneNumber.id)!
  const tags: string[] = []
  for (const [name, color] of [
    ['New customer', 'PRIMARY'],
    ['Television', 'INFO'],
  ] as const) {
    const tag = await page.request.post(`${API}/tags`, { headers, data: { name, color } })
    expect(tag.status(), await tag.text()).toBe(201)
    tags.push((await tag.json()).data.id)
  }
  const updated = await page.request.patch(`${API}/contacts/${conversation.contact.id}`, {
    headers,
    data: { name: 'Priya Sharma' },
  })
  expect(updated.status(), await updated.text()).toBe(200)
  for (const tagId of tags) {
    const tagged = await page.request.put(`${API}/conversations/${conversation.id}/tags/${tagId}`, {
      headers,
      data: {},
    })
    expect(tagged.ok()).toBe(true)
  }
  const note = await page.request.post(`${API}/contacts/${conversation.contact.id}/notes`, {
    headers,
    data: { body: 'Asked about television availability. Follow up after confirming stock.' },
  })
  expect(note.status(), await note.text()).toBe(201)
  for (const [i, [name, text]] of [
    ['ABC Electronics', 'Thank you. Can you confirm delivery tomorrow?'],
    ['Kumar Stores', 'Please share your catalogue.'],
    ['Anita Rao', 'Is this available in Nagercoil?'],
  ].entries()) {
    const incoming = await fetch(`${MOCK}/__mock/inbound`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: connection.phoneNumberId,
        from: `91949988000${i}`,
        name,
        text,
      }),
    })
    expect(incoming.ok).toBe(true)
  }
  // Real mock-provider imports and a domain-launched paused campaign supply honest review density.
  const imported = await fetch(`${MOCK}/__mock/templates`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId: connection.waba.id,
      add: [
        {
          name: 'delivery_update',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'Your requested delivery update is ready.' }],
        },
        {
          name: 'delivery_review',
          language: 'en',
          category: 'UTILITY',
          status: 'REJECTED',
          components: [{ type: 'BODY', text: 'Your delivery request has been reviewed.' }],
        },
      ],
    }),
  })
  expect(imported.ok, await imported.text()).toBe(true)
  const sync = await page.request.post(`${API}/templates/sync`, { headers, data: {} })
  expect(sync.ok(), await sync.text()).toBe(true)
  const templates = (
    await (
      await page.request.get(`${API}/templates/approved?phoneNumberId=${connection.id}`, {
        headers,
      })
    ).json()
  ).data
  const approved = templates.find((t: { name: string }) => t.name === 'delivery_update')
  const contactIds: string[] = []
  for (const [i, name] of ['Priya Shah', 'Farah Ali', 'Ravi Kumar'].entries()) {
    const created = await page.request.post(`${API}/contacts`, {
      headers,
      data: { name, phone: `+91942221100${i}` },
    })
    expect(created.status(), await created.text()).toBe(201)
    contactIds.push((await created.json()).data.id)
  }
  const created = await page.request.post(`${API}/campaigns`, {
    headers,
    data: {
      name: 'Festival customer update',
      phoneNumberId: connection.id,
      templateVersionId: approved.versionId,
      audience: { include: [{ kind: 'CONTACTS', contactIds }], exclude: [] },
      variableMapping: { body: [] },
      rateLimitPerMinute: 1,
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const campaignId = (await created.json()).data.id
  const launch = await page.request.post(`${API}/campaigns/${campaignId}/launch`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(launch.ok(), await launch.text()).toBe(true)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/campaigns/${campaignId}`, { headers })).json()).data
          .status,
      { timeout: 30_000 },
    )
    .toBe('RUNNING')
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/campaigns/${campaignId}/stats`, { headers })).json())
          .data.sent,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  const pause = await page.request.post(`${API}/campaigns/${campaignId}/pause`, { headers })
  expect(pause.ok(), await pause.text()).toBe(true)
  const flow = await page.request.post(`${API}/flows`, {
    headers,
    data: { name: 'New customer follow-up' },
  })
  expect(flow.status(), await flow.text()).toBe(201)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/dashboard')
  await expect(
    page.getByRole('list', { name: 'Recent conversations' }).getByRole('link'),
  ).toHaveCount(4)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome back, Arun', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Festival customer update', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Campaign messages sent' })).toHaveAttribute(
    'max',
    '3',
  )
  await expect(
    page.getByRole('region', { name: 'Needs attention' }).getByText(/campaign is paused/),
  ).toBeVisible()
  // Desktop composition is substantive: communications beside campaign/metrics, not a generic stack.
  const recent = await page
    .getByRole('heading', { name: 'Recent conversations', exact: true })
    .boundingBox()
  const campaign = await page
    .getByRole('heading', { name: 'Festival customer update', exact: true })
    .boundingBox()
  expect(Math.abs(recent!.y - campaign!.y)).toBeLessThan(5)
  expect(campaign!.x).toBeGreaterThan(recent!.x + 300)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true })
  }
  await page.getByRole('link', { name: 'View campaign', exact: true }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
})

test('Home keeps an unlaunched campaign honest: no fictional progress or delivery rates', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'home-draft')
  const created = await page.request.post(`${API}/campaigns`, {
    headers: ownerHeaders(owner),
    data: { name: 'Next customer update' },
  })
  expect(created.status()).toBe(201)
  await page.goto('/dashboard')
  await expect(
    page.getByRole('heading', { name: 'Next customer update', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Delivery results become available after launch.')).toBeVisible()
  await expect(page.getByText('Not started', { exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
})
