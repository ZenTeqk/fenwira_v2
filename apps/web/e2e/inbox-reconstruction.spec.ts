import AxeBuilder from '@axe-core/playwright'
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { type Conversation, type WhatsAppConnection } from '@fenwira/contracts'
import { API, MOCK, customerWritesIn, ownerHeaders, signInAsNewOwner } from './support'

/** Review fixtures are persisted through domain APIs; screenshots never replace server reads. */
test('Inbox reconstruction preserves real messaging and Home shell consistency at four widths', async ({
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
    const contactTagged = await page.request.post(`${API}/contacts/bulk`, {
      headers,
      data: { action: 'TAG', contactIds: [conversation.contact.id], tagId },
    })
    expect(contactTagged.ok(), await contactTagged.text()).toBe(true)
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
    ['Lakshmi Traders', 'Can you send the catalogue?'],
    ['Mohan Raj', 'Can you arrange installation?'],
    ['Vignesh', 'Do you have this in black?'],
    ['Revathi', 'Thank you for the details.'],
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
  const canned = await page.request.post(`${API}/canned-replies`, {
    headers,
    data: {
      shortcut: '/delivery',
      title: 'Delivery details',
      body: 'I’ll confirm the delivery options for you.',
    },
  })
  expect(canned.status(), await canned.text()).toBe(201)
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
  await page
    .getByLabel('Reply', { exact: true })
    .fill(
      'You can compare the available models in our catalogue. I’ll confirm the options before you visit.',
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(
    messages.getByText(
      'You can compare the available models in our catalogue. I’ll confirm the options before you visit.',
    ),
  ).toBeVisible()
  await expect
    .poll(() => Math.floor(Date.now() / 1000), { intervals: [100] })
    .toBeGreaterThan(Math.floor(Date.now() / 1000))
  const followup = await fetch(`${MOCK}/__mock/inbound`, {
    method: 'POST',
    body: JSON.stringify({
      phoneNumberId: connection.phoneNumberId,
      from: conversation.contact.phoneE164.replace(/^\+/, ''),
      name: 'Priya Sharma',
      text: 'Could you confirm whether delivery is available tomorrow?',
    }),
  })
  expect(followup.ok).toBe(true)
  await expect(
    messages.getByText('Could you confirm whether delivery is available tomorrow?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Internal note', exact: true }).click()
  await page
    .getByLabel('Internal note', { exact: true })
    .fill('Interested in the 55-inch model. Confirm stock before following up.')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(
    messages.getByText('Interested in the 55-inch model. Confirm stock before following up.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).data
  const assigned = await page.request.post(`${API}/conversations/${conversation.id}/assign`, {
    headers,
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
      await page.setViewportSize({ width, height: 1000 })
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
      if (width === 1440) {
        const geometry = await page.evaluate(() => {
          const box = (element: Element | null) => {
            if (!element) return null
            const { x, y, width, height } = element.getBoundingClientRect()
            return { x, y, width, height }
          }
          return {
            sidebar: box(document.querySelector('aside')),
            topbar: box(document.querySelector('header')),
            views: box(document.querySelector('[aria-label="Inbox views"]')),
            list: box(document.querySelector('[aria-label="Conversations"]')),
            firstRow: box(document.querySelector('[aria-label="Conversation list"] button')),
            ordinaryRow: box(
              document.querySelectorAll('[aria-label="Conversation list"] button')[1] ?? null,
            ),
            threadHeader: box(
              document.querySelector('[aria-label="Chat"]')?.firstElementChild ?? null,
            ),
            thread: box(document.querySelector('[aria-label="Chat"]')),
            context: box(document.querySelector('[aria-label="Contact"]')),
            composer: box(document.querySelector('[aria-label="Compose"]')?.parentElement ?? null),
          }
        })
        expect(geometry.sidebar?.width).toBe(224)
        expect(geometry.topbar?.height).toBe(56)
        writeFileSync(
          info.outputPath(`${name}-geometry-1440.json`),
          JSON.stringify(geometry, null, 2),
        )
      }
      if (name === 'inbox') {
        // Long, individually scrollable lists must not leak a second document scrollbar.
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
        ).toBeLessThanOrEqual(0)
      }
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true })
      if (name === 'inbox' && width === 1440) {
        await page.getByRole('button', { name: 'Internal note', exact: true }).click()
        await expect(page.getByLabel('Internal note', { exact: true })).toHaveAttribute(
          'placeholder',
          'Only your team sees notes',
        )
        await page.screenshot({ path: info.outputPath('inbox-note-1440.png'), fullPage: true })
        await page.getByRole('button', { name: 'Reply', exact: true }).click()
      }
      if (name === 'inbox' && width === 375) {
        await page.getByRole('button', { name: 'Contact details' }).click()
        await expect(
          page
            .getByRole('dialog', { name: 'Contact', exact: true })
            .getByRole('region', { name: 'Messaging eligibility' }),
        ).toBeVisible()
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([])
        await page.screenshot({ path: info.outputPath('inbox-context-375.png'), fullPage: true })
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Contact details' })).toBeFocused()
        await page.getByRole('button', { name: 'Back to conversations' }).click()
        await expect(page.getByRole('list', { name: 'Conversation list' })).toBeVisible()
        await page.screenshot({ path: info.outputPath('inbox-list-375.png'), fullPage: true })
      }
    }
  }
})

test('Inbox distinguishes empty, failed and searched states and supports keyboard selection', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const owner = await signInAsNewOwner(page, 'ui-inbox-states')
  await page.goto('/inbox')
  const conversations = page.getByRole('region', { name: 'Conversations', exact: true })
  await expect(conversations.getByText('Nothing here', { exact: true })).toBeVisible()
  const failedList = '**/api/v1/conversations?**'
  await page.route(failedList, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'UNAVAILABLE',
          message: 'Temporarily unavailable',
          correlationId: 'inbox-list-test',
        },
      }),
    }),
  )
  await page.reload()
  await expect(conversations.getByRole('alert').getByText('Something went wrong')).toBeVisible()
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.unroute(failedList)
  await conversations.getByRole('button', { name: 'Try again' }).click()
  await expect(conversations.getByText('Nothing here', { exact: true })).toBeVisible()
  const customer = await customerWritesIn(page, owner, 'Please confirm the delivery date.')
  await page.goto('/inbox')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await expect(list.getByText(customer)).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Search conversations' })
  await search.fill('no-such-inbox-record-849726')
  await expect(conversations.getByText('No matches', { exact: true })).toBeVisible()
  await search.fill('')
  const row = list.getByRole('button').filter({ hasText: customer })
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Please confirm the delivery date.'),
  ).toBeVisible()
})
