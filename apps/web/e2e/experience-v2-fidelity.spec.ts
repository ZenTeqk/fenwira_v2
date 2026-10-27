import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { type Conversation, type WhatsAppConnection } from '@fenwira/contracts'
import { API, MOCK, customerWritesIn, ownerHeaders, signInAsNewOwner } from './support'

/** Review fixtures are persisted through domain APIs; screenshots never replace server reads. */
test('Home and Inbox visual-fidelity evidence uses real communication records at four widths', async ({
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
    ['Suresh Kumar', 'What is the warranty on this model?'],
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
  for (const [path, name] of [
    ['campaigns', 'Festival customer update'],
    ['flows', 'New customer follow-up'],
  ] as const) {
    const created = await page.request.post(`${API}/${path}`, { headers, data: { name } })
    expect(created.status(), await created.text()).toBe(201)
  }
  await page.goto(`/inbox?c=${conversation.id}`)
  const messages = page.getByRole('log', { name: 'Messages' })
  await expect(
    messages.getByText('Do you have the 55-inch model? Can you share the price?'),
  ).toBeVisible()
  await page
    .getByLabel('Reply', { exact: true })
    .fill('Hi Priya! I’ll check availability and send the details shortly.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(
    messages.getByText('Hi Priya! I’ll check availability and send the details shortly.'),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Internal note', exact: true }).click()
  await page
    .getByLabel('Internal note', { exact: true })
    .fill('Interested in the 55-inch model. Confirm stock before following up.')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(
    messages.getByText('Interested in the 55-inch model. Confirm stock before following up.'),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Reply', exact: true }).click()
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).data
  const assigned = await page.request.post(`${API}/conversations/${conversation.id}/assign`, {
    // The page rotated the CSRF token since `headers` was built.
    headers: { ...headers, 'X-CSRF-Token': me.csrfToken },
    data: { assigneeId: me.user.id },
  })
  expect(assigned.ok()).toBe(true)
  for (const [name, path] of [
    ['home', '/dashboard'],
    ['inbox', `/inbox?c=${conversation.id}`],
  ] as const) {
    await page.goto(path)
    if (name === 'home')
      await expect(
        page.getByRole('list', { name: 'Recent conversations' }).getByRole('link'),
      ).toHaveCount(4)
    else
      await expect(
        messages.getByText('Interested in the 55-inch model. Confirm stock before following up.'),
      ).toBeVisible()
    for (const width of [1440, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: name === 'home' ? /Welcome back,/ : 'Inbox',
          exact: true,
        }),
      ).toBeAttached()
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
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true })
    }
  }
})
