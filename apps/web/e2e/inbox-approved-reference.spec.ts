import AxeBuilder from '@axe-core/playwright'
import { type ContactActivity } from '@fenwira/contracts'
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { mockFrontend } from './frontend-fixture'

// Browser-only review fixtures. No example customer data ships with the application.
async function inboxFixture(page: Page, { writable = true, assignment = true } = {}) {
  await mockFrontend(page, [
    'inbox.read',
    'inbox.reply',
    ...(assignment ? ['inbox.reassign', 'inbox.assign_self'] : []),
    'contacts.read',
    ...(writable ? ['contacts.write'] : []),
    'workspace.read',
  ])
  const now = Date.now()
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString()
  let expires = new Date(now + 23 * 3600000).toISOString()
  const tags = [
    { id: 'cake', name: 'Cake order', color: 'PRIMARY' },
    { id: 'follow', name: 'Follow-up', color: 'WARNING' },
  ]
  const contactTags = tags.map((tag) => ({ ...tag }))
  const customer: {
    id: string
    name: string | null
    waProfileName: string | null
    phoneE164: string
  } = {
    id: 'customer',
    name: 'Vijay',
    waProfileName: null,
    phoneE164: '+919876543210',
  }
  const conversation = {
    id: 'review',
    contact: customer,
    phoneNumber: { id: 'number', displayPhoneNumber: '+919999999999' },
    assignee: { id: 'preview-user', name: 'Priya' } as { id: string; name: string } | null,
    status: 'OPEN',
    automationState: 'AUTOMATION_PAUSED',
    tags: tags.map((tag) => ({ ...tag })),
    unreadCount: 2,
    lastMessageAt: at(1),
    lastMessagePreview: 'Can you confirm delivery by 5 pm?',
    serviceWindow: { isOpen: true, expiresAt: expires },
    serviceWindowExpiresAt: expires,
    lastCustomerMessageAt: at(1),
    createdAt: at(100),
    snoozedUntil: null,
    firstResponseAt: at(40),
  }
  const message = (
    id: string,
    direction: string,
    content: object,
    minutes: number,
    snapshot: object | null = null,
  ) => ({
    id,
    conversationId: 'review',
    contactId: 'customer',
    direction,
    type: 'TEXT',
    source: direction === 'INBOUND' ? 'CUSTOMER' : 'INBOX',
    status: 'READ',
    content,
    createdAt: at(minutes),
    sentByUserId: direction === 'OUTBOUND' ? 'preview-user' : null,
    templateSnapshot: snapshot,
    aiGenerated: false,
    providerMessageId: null,
    errorCode: null,
    errorDetail: null,
    sentAt: at(minutes),
    deliveredAt: at(minutes),
    readAt: at(minutes),
    failedAt: null,
    providerTimestamp: null,
  })
  let messages = [
    message(
      'question',
      'INBOUND',
      { type: 'TEXT', text: 'Hi! Could you share a quote for a 2 kg chocolate cake?' },
      45,
    ),
    message(
      'answer',
      'OUTBOUND',
      { type: 'TEXT', text: 'Hi Vijay! Here is your quotation for the chocolate cake.' },
      40,
    ),
    {
      ...message(
        'document',
        'OUTBOUND',
        {
          type: 'DOCUMENT',
          fileId: 'file',
          filename: 'Quotation-Q-00003.pdf',
          caption: 'Quotation total: ₹1,000.00',
        },
        40,
      ),
      type: 'DOCUMENT',
      media: {
        fileId: 'file',
        filename: 'Quotation-Q-00003.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 253952,
      },
    },
    message('thanks', 'INBOUND', { type: 'TEXT', text: 'Thank you, the quote looks good.' }, 3),
    message('delivery', 'INBOUND', { type: 'TEXT', text: 'Can you confirm delivery by 5 pm?' }, 1),
  ]
  const fields = {
    email: 'vijay@example.com' as string | null,
    language: 'Tamil, English' as string | null,
    country: null as string | null,
    properties: {} as Record<string, string | number | boolean | null>,
  }
  const contactNotes = [
    {
      id: 'contact-note',
      body: 'Prefers evening delivery.',
      authorId: 'preview-user',
      authorName: 'Priya',
      createdAt: at(20),
    },
  ]
  const activities: ContactActivity[] = []
  const members = [
    { userId: 'preview-user', name: 'Priya', status: 'ONLINE' },
    { userId: 'other-agent', name: 'Arun Kumar', status: 'AWAY' },
  ]
  let paginated = false
  let closed = false
  let restriction: { code: string; reason: string } | null = null
  let sendRejection: string | null = null
  let fail = false
  let empty = false
  const sent: unknown[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/v1', '')
    let data: unknown
    const current = {
      ...conversation,
      serviceWindow: {
        isOpen: !closed && Date.parse(expires) > Date.now(),
        expiresAt: closed ? at(60) : expires,
      },
    }
    if (path === '/conversations/counts') data = { all: 24, mine: 8, unassigned: 4 }
    else if (path === '/workspace')
      data = {
        id: 'preview-tenant',
        name: 'Preview workspace',
        timezone: 'Asia/Kolkata',
        country: 'IN',
        currency: 'INR',
      }
    else if (path === '/conversations') {
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        })
      const names = [
        customer.name,
        'Priya S.',
        'Arun Kumar',
        'Meena',
        'Naveen',
        'Karthik',
        'Anitha',
        'Dheeran Rentals',
      ]
      const rows = names.map((name, index) => ({
        ...current,
        id: index ? `other-${index}` : 'review',
        contact: { ...customer, id: index ? `contact-${index}` : customer.id, name },
        unreadCount: index % 3 === 0 ? 2 : 0,
      }))
      const q = url.searchParams.get('q')?.toLowerCase()
      return route.fulfill({
        json: {
          data: empty
            ? []
            : rows.filter(
                (r) => !q || (r.contact.name ?? r.contact.phoneE164).toLowerCase().includes(q),
              ),
          page: { nextCursor: null },
        },
      })
    } else if (path === '/conversations/review') data = current
    else if (path === '/conversations/review/assign') {
      const assigneeId = route.request().postDataJSON().assigneeId
      const member = members.find((member) => member.userId === assigneeId)
      conversation.assignee = member ? { id: member.userId, name: member.name } : null
      data = { ...current, assignee: conversation.assignee }
    } else if (path === '/conversations/review/messages') {
      if (route.request().method() === 'POST') {
        if (sendRejection) {
          const code = sendRejection
          sendRejection = null
          if (code === 'CONVERSATION_WINDOW_CLOSED') closed = true
          return route.fulfill({
            status: 422,
            json: { error: { code, message: 'The message could not be sent.' } },
          })
        }
        const body = route.request().postDataJSON()
        sent.push(body)
        const added = message(`sent-${sent.length}`, 'OUTBOUND', body.content, 0)
        messages = [...messages, added]
        return route.fulfill({ json: { data: added } })
      }
      if (paginated) {
        const newestFirst = [...messages].reverse()
        const offset = url.searchParams.has('before') ? 50 : 0
        return route.fulfill({
          json: {
            data: newestFirst.slice(offset, offset + 50),
            page: { nextCursor: offset ? null : 'older' },
          },
        })
      }
      const mediaType = url.searchParams.get('type')?.toUpperCase()
      const filtered = mediaType
        ? messages.filter((m) => m.type === mediaType)
        : url.searchParams.get('kind')
          ? []
          : messages
      return route.fulfill({ json: { data: [...filtered].reverse(), page: { nextCursor: null } } })
    } else if (path === '/conversations/review/notes')
      data = [
        {
          id: 'note',
          conversationId: 'review',
          body: 'Customer requested evening delivery. Confirm with the kitchen.',
          authorName: 'Priya',
          createdAt: at(20),
        },
      ]
    else if (path === '/conversations/review/media-counts')
      data = { all: messages.length, image: 0, video: 0, document: 1, audio: 0, template: 0 }
    else if (path === '/conversations/review/compose-lock')
      data = { conversationId: 'review', holder: null, expiresAt: null }
    else if (path === '/contacts/customer') {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON()
        if ('name' in body) customer.name = body.name
        if ('phone' in body) customer.phoneE164 = body.phone
        for (const field of ['email', 'language', 'country'] as const)
          if (field in body) fields[field] = body[field]
        if (body.properties) Object.assign(fields.properties, body.properties)
      }
      data = {
        ...customer,
        ...fields,
        tags: contactTags,
        marketingConsent: 'NONE',
        utilityConsent: 'NONE',
      }
    } else if (path === '/contacts/bulk') {
      const body = route.request().postDataJSON()
      const tag = tags.find((tag) => tag.id === body.tagId)
      if (body.action === 'UNTAG') {
        const index = contactTags.findIndex((tag) => tag.id === body.tagId)
        if (index >= 0) contactTags.splice(index, 1)
      } else if (tag && !contactTags.some((existing) => existing.id === tag.id))
        contactTags.push({ ...tag })
      activities.unshift({
        id: `activity-${activities.length}`,
        type: body.action === 'UNTAG' ? 'tag.removed' : 'tag.added',
        actorType: 'USER',
        actorId: 'preview-user',
        actorName: 'Priya',
        data: { tag: tag?.name, tagId: body.tagId },
        occurredAt: new Date().toISOString(),
      })
      data = { affected: 1 }
    } else if (path === '/contacts/customer/eligibility')
      data = {
        freeform: {
          allowed: current.serviceWindow.isOpen && !restriction,
          reason:
            restriction?.reason ?? (current.serviceWindow.isOpen ? null : 'Reply window closed'),
          code:
            restriction?.code ??
            (current.serviceWindow.isOpen ? null : 'CONVERSATION_WINDOW_CLOSED'),
          optedOut: false,
        },
        utilityTemplate: {
          allowed: !restriction,
          reason: restriction?.reason ?? null,
          code: restriction?.code ?? null,
          optedOut: false,
        },
        marketingTemplate: {
          allowed: false,
          reason: 'Consent unknown',
          code: 'CONSENT_REQUIRED',
          optedOut: false,
        },
        serviceWindowExpiresAt: current.serviceWindow.expiresAt,
      }
    else if (path === '/conversations/review/automation-state') {
      conversation.automationState = route.request().postDataJSON().state
      data = { ...current, automationState: conversation.automationState }
    } else if (path === '/contacts/customer/notes') {
      if (route.request().method() === 'POST') {
        const note = {
          id: `contact-note-${contactNotes.length}`,
          body: route.request().postDataJSON().body,
          authorId: 'preview-user',
          authorName: 'Priya',
          createdAt: new Date().toISOString(),
        }
        contactNotes.unshift(note)
        activities.unshift({
          id: `activity-${activities.length}`,
          type: 'note.added',
          actorType: 'USER',
          actorId: 'preview-user',
          actorName: 'Priya',
          data: { noteId: note.id },
          occurredAt: note.createdAt,
        })
        return route.fulfill({ status: 201, json: { data: note } })
      }
      data = contactNotes
    } else if (path === '/contacts/customer/conversations') data = []
    else if (path === '/contacts/customer/activities') {
      const offset = url.searchParams.has('cursor') ? 50 : 0
      return route.fulfill({
        json: {
          data: activities.slice(offset, offset + 50),
          page: { nextCursor: activities.length > offset + 50 ? 'activity-older' : null },
        },
      })
    } else if (path === '/inbox/presence') data = members
    else if (path === '/inbox/unread-count') data = { conversations: 4 }
    else if (path === '/files/file/download-url') data = { url: '/brand/apple-icon.png' }
    else if (path === '/tags') data = tags
    else if (path === '/canned-replies')
      data = [
        {
          id: 'saved',
          title: 'Delivery',
          shortcut: '/delivery',
          body: 'We will confirm delivery shortly.',
        },
      ]
    else return route.fallback()
    await route.fulfill({ json: { data } })
  })
  return {
    conversation,
    message,
    sent,
    customer,
    fields,
    contactNotes,
    activities,
    tags,
    contactTags,
    setWindow: (ms: number) => {
      expires = new Date(Date.now() + ms).toISOString()
      closed = false
      return expires
    },
    restrict: (code: string, reason: string) => {
      restriction = { code, reason }
    },
    rejectNextSend: (code: string) => {
      sendRejection = code
    },
    messages,
    paginate: () => {
      paginated = true
      messages = Array.from({ length: 100 }, (_, i) =>
        message(`history-${i}`, 'INBOUND', { type: 'TEXT', text: `History message ${i}` }, 100 - i),
      )
    },
    close: () => {
      closed = true
    },
    fail: () => {
      fail = true
    },
    empty: () => {
      empty = true
    },
  }
}

const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations
const shots = process.env.INBOX_SHOTS_DIR

test('compact composer grows internally, keeps one toolbar and restores the conditional details trigger', async ({
  page,
}) => {
  const fixture = await inboxFixture(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const chat = page.getByRole('region', { name: 'Conversation', exact: true })
  const composer = chat.locator('.fw-inbox-composer')
  const input = chat.getByRole('textbox', { name: 'Reply', exact: true })
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const trigger = page.getByRole('button', { name: 'Show contact details', exact: true })
  const close = panel.getByRole('button', { name: 'Close contact details', exact: true })
  await expect(panel).toBeVisible()
  await expect(input).toBeEnabled()
  await expect(composer.getByRole('button', { name: /left\. Free-form/ })).toBeVisible()
  expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(40)
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(48)
  expect((await composer.boundingBox())!.height).toBeGreaterThanOrEqual(112)
  expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(136)
  await expect(chat.getByRole('button', { name: /(?:Show|Hide) contact details/ })).toHaveCount(0)
  const actions = composer.getByRole('group', { name: 'Message actions' })
  await expect(actions).toHaveCount(1)
  await expect(actions.getByRole('button', { name: 'Send a template' })).toContainText('Templates')
  await expect(
    composer.getByText('Enter to send · Shift+Enter for a new line', { exact: true }),
  ).toHaveCount(0)
  // The shortcut is available on hover even while the empty Send button is disabled.
  await actions.getByRole('button', { name: 'Send', exact: true }).locator('..').hover()
  await expect(page.getByRole('tooltip')).toContainText('Enter to send')
  const attachment = actions.getByRole('button', { name: 'Attach a file', exact: true })
  await expect(attachment).toBeEnabled()
  await attachment.hover()
  await expect(page.getByRole('tooltip')).toContainText('Attach a file')
  const choosing = page.waitForEvent('filechooser')
  await attachment.click()
  await (await choosing).setFiles([])
  await actions.getByRole('button', { name: 'Canned replies', exact: true }).press('Enter')
  await page.getByRole('menuitem', { name: /\/delivery.*Delivery/ }).click()
  await expect(input).toHaveValue('We will confirm delivery shortly.')
  expect(fixture.sent).toHaveLength(0)
  await input.fill('Long reply line\n'.repeat(30))
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(160)
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await input.fill('Keep this compact reply')
  await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThanOrEqual(48)
  await close.click()
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  await expect(close).toBeFocused()
  await expect(trigger).toHaveCount(0)
  await expect(input).toHaveValue('Keep this compact reply')
  await composer.getByRole('tab', { name: 'Reply', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(composer.getByRole('tab', { name: 'Internal note', exact: true })).toBeFocused()
  const note = chat.getByRole('textbox', { name: 'Internal note', exact: true })
  await note.fill('Keep this private draft')
  await expect(composer.getByRole('button', { name: 'Add note', exact: true })).toBeEnabled()
  await expect(composer.getByRole('button', { name: 'Save note', exact: true })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'compact-composer-note-1440.png') })
  await composer.getByRole('tab', { name: 'Reply', exact: true }).click()
  await expect(input).toHaveValue('Keep this compact reply')
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(input).toBeInViewport()
    await expect(actions.getByRole('button', { name: 'Send a template' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await trigger.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Customer details' })).toBeVisible()
  await expect(trigger).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(input).toHaveValue('Keep this compact reply')
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'compact-composer-375.png') })
  await input.fill('')
  expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(136)
  await page.addStyleTag({ content: 'html { font-size: 20px; }' })
  await expect(actions.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('approved inbox: desktop proportions, real actions, IME, details, responsive layout and accessibility', async ({
  page,
}) => {
  test.setTimeout(180000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const fixture = await inboxFixture(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Can you confirm delivery by 5 pm?')).toBeVisible()
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  await expect(panel).toBeVisible()
  expect((await page.locator('aside:has(nav[aria-label="Main"])').boundingBox())?.width).toBe(224)
  expect(
    (await page.getByRole('region', { name: 'Conversations', exact: true }).boundingBox())?.width,
  ).toBe(319)
  expect((await panel.boundingBox())?.width).toBe(320)
  await expect(page.getByRole('group', { name: 'Show messages' })).toHaveCount(0)
  await expect(log.getByRole('link', { name: 'Download Quotation-Q-00003.pdf' })).toBeVisible()
  await expect(log).toContainText('248 KB')
  await expect(panel).toContainText('vijay@example.com')
  await expect(panel).toContainText('Prefers evening delivery.')
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('A growing multiline reply\n'.repeat(20))
  expect((await reply.boundingBox())!.height).toBeLessThanOrEqual(160)
  await reply.fill('Keep my draft')
  await reply.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  expect(fixture.sent).toHaveLength(0)
  await expect(reply).toHaveValue('Keep my draft')
  expect(await axe(page)).toEqual([])
  await panel.getByRole('button', { name: 'Messaging eligibility', exact: true }).click()
  expect(await axe(page)).toEqual([])
  await panel.getByRole('button', { name: 'Messaging eligibility', exact: true }).click()
  if (shots) await page.screenshot({ path: join(shots, 'inbox-1440.png') })
  await panel.getByRole('tab', { name: 'Files', exact: true }).click()
  await panel.getByRole('button', { name: /Documents/ }).click()
  await expect(panel.getByText('Quotation-Q-00003.pdf')).toBeVisible()
  await panel.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(panel.getByText('No other conversations with this customer.')).toBeVisible()
  await panel.getByRole('tab', { name: 'Overview', exact: true }).click()
  await panel.getByRole('button', { name: 'Close contact details' }).click()
  await expect(panel).toBeHidden()
  await expect(reply).toHaveValue('Keep my draft')
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await page.getByRole('tab', { name: 'Internal note', exact: true }).click()
  const note = page.getByLabel('Internal note', { exact: true })
  await note.fill('A private team note')
  await expect(
    page.locator('.fw-inbox-composer').getByRole('button', { name: 'Add note', exact: true }),
  ).toBeEnabled()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-note-1440.png') })
  await page.getByRole('tab', { name: 'Reply', exact: true }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => fixture.sent.length).toBe(1)
  await expect(reply).toHaveValue('')
  for (const width of [1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(reply).toBeInViewport()
    if (width === 1024) {
      await page.getByRole('button', { name: 'Show contact details' }).click()
      const drawer = page.getByRole('dialog', { name: 'Customer details' })
      await expect(drawer).toBeVisible()
      await expect(panel).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(await axe(page)).toEqual([])
      if (shots) await page.screenshot({ path: join(shots, 'inbox-drawer-1024.png') })
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await axe(page)).toEqual([])
    if (shots) await page.screenshot({ path: join(shots, `inbox-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('dialog', { name: 'Customer details' })).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(page.getByRole('list', { name: 'Conversation list' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('No matching customer')
  await expect(page.getByText('No matches', { exact: true })).toBeVisible()
  fixture.close()
  await page.goto('/inbox?c=review')
  await expect(page.getByRole('button', { name: 'Choose template', exact: true })).toBeVisible()
  expect(await axe(page)).toEqual([])
  expect(pageErrors).toEqual([])
})

test('long names and documents, missing fields, failed message/upload and list states', async ({
  page,
}) => {
  const fixture = await inboxFixture(page)
  fixture.customer.name =
    'A very long customer name that must remain contained within the inbox panels'
  fixture.fields.email = null
  fixture.fields.language = null
  const filename = `${'quotation-with-a-long-name-'.repeat(8)}.pdf`
  Object.assign(fixture.messages[2]!, {
    media: { fileId: 'file', filename, mimeType: 'application/pdf', sizeBytes: 253952 },
  })
  Object.assign(fixture.messages[1]!, {
    status: 'FAILED',
    errorCode: 'PROVIDER_ERROR',
    errorDetail: 'The provider rejected this message.',
  })
  await page.route('**/api/v1/files/upload-url', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'Upload unavailable' } },
    }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Failed', { exact: true })).toBeVisible()
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  await expect(panel.getByRole('button', { name: 'Add email', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Set language', exact: true })).toBeVisible()
  await expect(log.getByRole('link', { name: `Download ${filename}` })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'quote.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('test attachment'),
  })
  await expect(page.getByText('Upload unavailable', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await axe(page)).toEqual([])
  fixture.customer.name = null
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByRole('heading', { name: '+919876543210', exact: true }),
  ).toBeVisible()
  fixture.empty()
  await page.goto('/inbox')
  await expect(page.getByText('Nothing here', { exact: true })).toBeVisible()
  fixture.fail()
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Conversations', exact: true }).getByRole('alert'),
  ).toBeVisible()
})

test('loading older history preserves the visible message position', async ({ page }) => {
  const fixture = await inboxFixture(page)
  fixture.paginate()
  await page.setViewportSize({ width: 1440, height: 640 })
  await page.goto('/inbox?c=review')
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('History message 99')).toBeVisible()
  await log.evaluate((el) => {
    el.scrollTop = 0
  })
  const first = log.getByText('History message 50', { exact: true })
  await expect(first).toBeInViewport()
  const before = (await first.boundingBox())!.y
  await log.getByRole('button', { name: 'Load earlier messages' }).click()
  await expect(log.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0)
  await expect(first).toBeInViewport()
  await expect
    .poll(async () => Math.abs((await first.boundingBox())!.y - before))
    .toBeLessThanOrEqual(8)
})

test('message filters hide after choosing any type and retain the selection when reopened', async ({
  page,
}) => {
  await inboxFixture(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Filter conversation messages', exact: true })
  const filters = page.getByRole('group', { name: 'Show messages' })
  for (const label of ['All', 'Images', 'Video', 'Documents', 'Audio', 'Templates', 'Notes']) {
    await toggle.click()
    const chip = filters.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) })
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(filters).toHaveCount(0)
    await toggle.click()
    await expect(filters).toBeVisible()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(filters).toHaveCount(0)
  }
})

// A browser that normally uses 24-hour clocks must still show the requested AM/PM format.
test.describe('readable inbox filters and timestamps', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Asia/Kolkata', reducedMotion: 'reduce' })

  test('single-row filters support arrows, horizontal gestures and keyboard focus; times show AM/PM', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await inboxFixture(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/inbox?c=review')
    const log = page.getByRole('log', { name: 'Messages' })
    await expect(log.getByText('Can you confirm delivery by 5 pm?')).toBeVisible()
    for (const id of ['delivery', 'answer', 'document']) {
      await expect(page.locator(`[data-message-id="${id}"]`)).toContainText(/\d{1,2}:\d{2}\s[AP]M/)
    }
    await expect(
      page.getByRole('list', { name: 'Conversation list' }).getByRole('button').first(),
    ).toContainText(/\d{1,2}:\d{2}\s[AP]M/)
    await page.getByRole('button', { name: 'Filter conversation messages', exact: true }).click()
    const filters = page.getByRole('group', { name: 'Show messages' })
    const scroller = filters.locator('[data-slot="message-filter-scroll"]')
    const left = filters.getByRole('button', { name: 'Scroll message filters left', exact: true })
    const right = filters.getByRole('button', { name: 'Scroll message filters right', exact: true })
    const chip = (label: string) =>
      filters.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) })
    const fullyVisible = async (label: string) => {
      await expect
        .poll(async () => {
          const item = (await chip(label).boundingBox())!
          const view = (await scroller.boundingBox())!
          return (
            item.x >= view.x - 1 &&
            item.x + item.width <= view.x + view.width + 1 &&
            item.y >= view.y &&
            item.y + item.height <= view.y + view.height
          )
        })
        .toBe(true)
    }
    let sawOverflow = false
    for (const width of [1440, 1280, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 })
      await chip('All').focus()
      await fullyVisible('All')
      const positions = await filters
        .locator('[data-slot="message-filter-scroll"] button')
        .evaluateAll((buttons) => buttons.map((el) => el.getBoundingClientRect().top))
      expect(positions.every((top) => Math.abs(top - positions[0]!) < 1)).toBe(true)
      const overflow = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
      if (overflow) {
        sawOverflow = true
        await expect(left).toBeDisabled()
        await expect(right).toBeEnabled()
        if (shots && (width === 1280 || width === 375))
          await filters.screenshot({ path: join(shots, `filter-arrows-start-${width}.png`) })
        for (
          let step = 0;
          step < 10 &&
          (await scroller.evaluate((el) => el.scrollLeft + el.clientWidth < el.scrollWidth - 1));
          step++
        ) {
          const before = await scroller.evaluate((el) => el.scrollLeft)
          await right.click()
          await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before)
        }
        await fullyVisible('Notes')
        await expect(right).toBeDisabled()
        await expect(left).toBeEnabled()
        if (shots && (width === 1280 || width === 375))
          await filters.screenshot({ path: join(shots, `filter-arrows-end-${width}.png`) })
        for (
          let step = 0;
          step < 10 && (await scroller.evaluate((el) => el.scrollLeft > 1));
          step++
        ) {
          const before = await scroller.evaluate((el) => el.scrollLeft)
          await left.click()
          await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeLessThan(before)
        }
        await fullyVisible('All')
        await expect(left).toBeDisabled()
        const bounds = (await scroller.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.wheel(240, 0)
        await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
        await chip('All').focus()
        await fullyVisible('All')
        for (let tab = 0; tab < 6; tab++) await page.keyboard.press('Tab')
        await expect(chip('Notes')).toBeFocused()
        await fullyVisible('Notes')
      } else {
        await expect(left).toHaveCount(0)
        await expect(right).toHaveCount(0)
        await fullyVisible('Notes')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(await axe(page)).toEqual([])
    }
    expect(sawOverflow).toBe(true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await left.click()
    await fullyVisible('All')
    await right.click()
    await fullyVisible('Notes')
  })
})

test('compact inbox view tabs contain their labels, counts and hover backgrounds', async ({
  page,
}) => {
  await inboxFixture(page)
  let viewCounts = { all: 80, mine: 0, unassigned: 80 }
  await page.route('**/api/v1/conversations/counts*', (route) =>
    route.fulfill({ json: { data: viewCounts } }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox')
  const list = page.getByRole('region', { name: 'Conversations', exact: true })
  const views = list.getByRole('group', { name: 'Inbox views', exact: true })
  const controls = list.getByRole('group', { name: 'Conversation filters', exact: true })
  await expect(views.getByRole('button', { name: 'All 80', exact: true })).toBeVisible()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const name of ['All 80', 'Mine 0', 'Unassigned 80']) {
      const tab = views.getByRole('button', { name, exact: true })
      await tab.click()
      await tab.hover()
      await expect(tab).toHaveAttribute('aria-pressed', 'true')
      expect(
        await views.evaluate((el) => {
          const outer = el.getBoundingClientRect()
          const tabs = [...el.querySelectorAll('button')]
          return tabs.every((button, index) => {
            const bounds = button.getBoundingClientRect()
            const previous = tabs[index - 1]?.getBoundingClientRect()
            return (
              bounds.left >= outer.left &&
              bounds.right <= outer.right + 0.5 &&
              (!previous || previous.right <= bounds.left) &&
              [...button.children].every((child) => {
                const inner = child.getBoundingClientRect()
                return (
                  inner.left >= bounds.left &&
                  inner.right <= bounds.right + 0.5 &&
                  child.scrollWidth <= child.clientWidth
                )
              })
            )
          })
        }),
      ).toBe(true)
    }
    await views.getByRole('button', { name: 'Mine 0', exact: true }).click()
    await views.getByRole('button', { name: 'Mine 0', exact: true }).hover()
    expect((await views.boundingBox())!.height).toBeLessThanOrEqual(36)
    expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(48)
    expect(await controls.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(
      await controls
        .getByRole('combobox', { name: 'Conversation status' })
        .locator('span')
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (shots && (width === 1440 || width === 768)) {
      const top = (await views.boundingBox())!
      const bottom = (await controls.boundingBox())!
      await page.screenshot({
        path: join(shots, `compact-list-filters-${width}.png`),
        clip: {
          x: bottom.x,
          y: top.y,
          width: bottom.width,
          height: bottom.y + bottom.height - top.y,
        },
      })
    }
    expect(await axe(page)).toEqual([])
  }
  const unread = controls.getByRole('button', { name: 'Unread', exact: true })
  await unread.click()
  await expect(unread).toHaveAttribute('aria-pressed', 'true')
  await controls.getByRole('combobox', { name: 'Conversation status' }).click()
  await page.getByRole('option', { name: 'Resolved', exact: true }).click()
  await expect(controls.getByRole('combobox', { name: 'Conversation status' })).toContainText(
    'Resolved',
  )
  await expect(controls.getByRole('button', { name: /^Filter ·/ })).toHaveCount(0)
  await list.getByRole('button', { name: 'Advanced conversation filters', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Agent takeover', exact: true }).click()
  const takeover = controls.getByRole('button', {
    name: 'Remove Agent takeover filter',
    exact: true,
  })
  await expect(takeover).toBeVisible()
  await takeover.click()
  await expect(takeover).toHaveCount(0)
  viewCounts = { all: 1234567, mine: 2300, unassigned: 1232267 }
  await page.reload()
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(views.getByRole('button', { name: 'All 1234567', exact: true })).toBeVisible()
    await expect(views.getByRole('button', { name: 'Mine 2300', exact: true })).toContainText(
      '2.3K',
    )
    expect(
      await views.evaluate((el) =>
        [...el.querySelectorAll('button span')].every(
          (span) => span.scrollWidth <= span.clientWidth,
        ),
      ),
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('inbox panel icons use a consistent smaller scale and the duplicate view menu is absent', async ({
  page,
}) => {
  await inboxFixture(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('Can you confirm delivery by 5 pm?')).toBeVisible()
  const list = page.getByRole('region', { name: 'Conversations', exact: true })
  await expect(list.getByRole('button', { name: /^Filter ·/ })).toHaveCount(0)
  for (const name of [
    'More conversation actions',
    'Filter conversation messages',
    'Close contact details',
    'Add note',
  ]) {
    const action = page.getByRole('button', { name, exact: true })
    await expect(action).toBeVisible()
    expect((await action.locator('svg').first().boundingBox())!.width).toBe(14)
  }
  expect(
    (await log
      .getByRole('link', { name: 'Download Quotation-Q-00003.pdf' })
      .locator('svg')
      .boundingBox())!.width,
  ).toBe(14)
  expect(
    (await page.locator('[data-message-id="document"] svg').first().boundingBox())!.width,
  ).toBe(20)
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  expect(
    (await panel
      .getByRole('region', { name: 'Contact fields' })
      .locator('svg')
      .first()
      .boundingBox())!.width,
  ).toBe(14)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-refined-icons-1440.png') })
  await page.getByRole('button', { name: 'More conversation actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Shared files', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 375, height: 1000 })
  const details = page.getByRole('button', { name: 'Show contact details', exact: true })
  expect((await details.boundingBox())!.height).toBeGreaterThanOrEqual(32)
  await details.click()
  const drawer = page.getByRole('dialog', { name: 'Customer details', exact: true })
  await expect(drawer).toBeVisible()
  expect(
    (await drawer
      .getByRole('region', { name: 'Contact fields' })
      .locator('svg')
      .first()
      .boundingBox())!.width,
  ).toBe(14)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'inbox-refined-icons-drawer-375.png') })
  await page.keyboard.press('Escape')
  await expect(details).toBeFocused()
})

test('refined list preserves combined filters, pagination and focus without fetching row details', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const fixture = await inboxFixture(page)
  const requests: string[] = []
  const queries: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    requests.push(url.pathname)
    if (url.pathname.endsWith('/conversations')) queries.push(url)
  })
  const rows = Array.from({ length: 45 }, (_, index) => ({
    ...fixture.conversation,
    id: index ? `row-${index}` : 'review',
    contact: {
      ...fixture.customer,
      id: `contact-${index}`,
      name:
        index === 1
          ? 'A very long customer name that must remain available through its tooltip 2'
          : index === 2
            ? null
            : `Textile Demo Shopper ${79 + index}`,
    },
    assignee: index % 2 ? null : fixture.conversation.assignee,
    unreadCount: index % 2 ? 0 : 3,
    automationState: index % 2 ? 'AUTOMATION_ACTIVE' : 'AGENT_TAKEOVER',
    lastMessagePreview:
      index === 0
        ? 'Template: order_status_update'
        : index === 1
          ? 'Invoice for a particularly long customer filename and delivery details.pdf'
          : fixture.conversation.lastMessagePreview,
  }))
  const filtered = (url: URL, view?: string) =>
    rows.filter(
      (row) =>
        (!url.searchParams.has('q') ||
          (row.contact.name ?? row.contact.phoneE164)
            .toLowerCase()
            .includes(url.searchParams.get('q')!.toLowerCase())) &&
        (!url.searchParams.has('unread') || row.unreadCount > 0) &&
        url.searchParams.get('status') !== 'RESOLVED' &&
        (view !== 'mine' || row.assignee?.id === 'preview-user') &&
        (view !== 'unassigned' || !row.assignee) &&
        (view !== 'takeover' || row.automationState === 'AGENT_TAKEOVER') &&
        (!url.searchParams.has('assigneeId') ||
          row.assignee?.id === url.searchParams.get('assigneeId')) &&
        (!url.searchParams.has('unassigned') || !row.assignee),
    )
  await page.route('**/api/v1/conversations/counts*', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json: {
        data: {
          all: filtered(url).length,
          mine: filtered(url, 'mine').length,
          unassigned: filtered(url, 'unassigned').length,
        },
      },
    })
  })
  await page.route(/\/api\/v1\/conversations\?/, (route) => {
    const url = new URL(route.request().url())
    const matches = filtered(url, url.searchParams.get('view') ?? undefined)
    const offset = url.searchParams.has('cursor') ? 30 : 0
    return route.fulfill({
      json: {
        data: matches.slice(offset, offset + 30),
        page: { nextCursor: matches.length > offset + 30 ? 'page2' : null },
      },
    })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox')
  const region = page.getByRole('region', { name: 'Conversations', exact: true })
  const list = region.getByRole('list', { name: 'Conversation list' })
  const views = region.getByRole('group', { name: 'Inbox views' })
  const first = list.getByRole('button').first()
  await expect(first).toContainText('Template · order status update')
  await expect(first.locator('[data-slot="avatar"]').first()).toHaveText('79')
  const avatarColor = await first
    .locator('[data-slot="avatar"] span')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  await first.focus()
  await expect(first).toBeFocused()
  await expect(first).not.toHaveAttribute('aria-current', 'true')
  expect(requests.some((path) => path.endsWith('/read'))).toBe(false)
  expect(requests.some((path) => /\/conversations\/.+\/messages/.test(path))).toBe(false)
  await list.getByRole('button').nth(1).focus()
  await expect(page.getByRole('tooltip')).toContainText(rows[1]!.contact.name!)
  await page.keyboard.press('Escape')
  const chooseView = async (name: string, params: Record<string, string>) => {
    const button = views.getByRole('button', { name: new RegExp(`^${name}( |$)`) })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    // Returning to a fresh cached view need not issue another request.
    await expect
      .poll(() =>
        queries.some((url) =>
          Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value),
        ),
      )
      .toBe(true)
  }
  await chooseView('Mine', { view: 'mine' })
  await expect(views.getByRole('button', { name: 'Mine 23', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await chooseView('Unassigned', { view: 'unassigned' })
  await expect(list.getByRole('button')).toHaveCount(22)
  await chooseView('All', { view: 'all' })
  await region.getByRole('button', { name: 'Advanced conversation filters' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Agent takeover' }).click()
  await expect(region.getByRole('button', { name: 'Remove Agent takeover filter' })).toBeVisible()
  await region.getByRole('button', { name: 'Unread', exact: true }).click()
  await chooseView('Mine', { view: 'takeover', assigneeId: 'preview-user', unread: 'true' })
  await region.getByRole('combobox', { name: 'Conversation status' }).click()
  await Promise.all([
    page.waitForRequest((request) => {
      const url = new URL(request.url())
      return (
        url.pathname.endsWith('/conversations') &&
        url.searchParams.get('status') === 'RESOLVED' &&
        url.searchParams.get('unread') === 'true' &&
        url.searchParams.get('view') === 'takeover' &&
        url.searchParams.get('assigneeId') === 'preview-user'
      )
    }),
    page.getByRole('option', { name: 'Resolved', exact: true }).click(),
  ])
  await expect(region.getByText('Nothing here', { exact: true })).toBeVisible()
  await region.getByRole('combobox', { name: 'Conversation status' }).click()
  await page.getByRole('option', { name: 'Open & waiting', exact: true }).click()
  await region.getByRole('button', { name: 'Remove Agent takeover filter' }).click()
  await region.getByRole('button', { name: 'Unread', exact: true }).click()
  await chooseView('All', { view: 'all' })
  const search = region.getByRole('searchbox', { name: 'Search conversations' })
  await search.fill('Textile Demo Shopper 79')
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(views.getByRole('button', { name: 'All 1', exact: true })).toBeVisible()
  await expect(first.locator('[data-slot="avatar"] span').first()).toHaveCSS(
    'background-color',
    avatarColor,
  )
  await search.press('Escape')
  await expect(views.getByRole('button', { name: 'All 45', exact: true })).toBeVisible()
  await list.getByRole('button').last().scrollIntoViewIfNeeded()
  await expect(list.getByRole('button')).toHaveCount(45)
  expect(requests.some((path) => /\/conversations\/.+\/messages/.test(path))).toBe(false)
  await list.getByRole('button').first().scrollIntoViewIfNeeded()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await first.hover()
    expect(await axe(page)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (shots) await page.screenshot({ path: join(shots, `refined-list-${width}.png`) })
  }
  await page.addStyleTag({ content: 'html { font-size: 20px; }' })
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(95)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('compact system events and closed-window notice retain full history and template action', async ({
  page,
}) => {
  const fixture = await inboxFixture(page)
  fixture.close()
  fixture.messages.push(
    {
      ...fixture.message(
        'takeover-event',
        'SYSTEM',
        { type: 'SYSTEM_EVENT', event: 'takeover', data: { actorName: 'Priya' } },
        8,
      ),
      type: 'SYSTEM_EVENT',
    },
    {
      ...fixture.message(
        'resume-event',
        'SYSTEM',
        { type: 'SYSTEM_EVENT', event: 'automation_resumed', data: { actorName: 'Priya' } },
        7,
      ),
      type: 'SYSTEM_EVENT',
    },
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const notice = page
    .getByRole('status')
    .filter({ has: page.getByText('Reply window closed', { exact: true }) })
  await expect(notice).toContainText('Choose an approved template to message this customer.')
  await expect(notice.getByRole('button', { name: 'Choose template' })).toBeEnabled()
  const log = page.getByRole('log', { name: 'Messages' })
  for (const wording of ['Priya took over from automation', 'Priya returned it to automation']) {
    await expect(log.getByText(wording, { exact: false })).toBeVisible()
  }
  const events = page.locator(
    '[data-message-id="takeover-event"], [data-message-id="resume-event"]',
  )
  expect(
    await events.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-message-id'))),
  ).toEqual(['takeover-event', 'resume-event'])
  expect((await events.first().boundingBox())!.height).toBeLessThan(32)
  await expect(log.getByText('Can you confirm delivery by 5 pm?', { exact: true })).toBeVisible()
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(notice).toBeInViewport()
    expect(await axe(page)).toEqual([])
    if (width === 375) {
      const copy = (await notice
        .getByText('Choose an approved template to message this customer.')
        .boundingBox())!
      expect(
        (await notice.getByRole('button', { name: 'Choose template' }).boundingBox())!.y,
      ).toBeGreaterThanOrEqual(copy.y + copy.height)
    }
    if (shots) await page.screenshot({ path: join(shots, `compact-closed-window-${width}.png`) })
  }
  await notice.getByRole('button', { name: 'Choose template' }).click()
  await expect(page.getByRole('dialog', { name: 'Send a template' })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(fixture.sent).toHaveLength(0)
})

test('already-loaded latest messages enrich previews without per-row requests or fabricated template text', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const fixture = await inboxFixture(page)
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  const body = 'Hi Vijay, your chocolate cake is ready for collection.'
  const latest = {
    ...fixture.message(
      'latest-template',
      'OUTBOUND',
      { type: 'TEMPLATE', name: 'cake_ready_update', language: 'en' },
      0,
      {
        v: 1,
        name: 'cake_ready_update',
        language: 'en',
        category: 'UTILITY',
        header: null,
        body,
        footer: null,
        buttons: [],
        variables: { body: [] },
        partial: false,
        missing: [],
      },
    ),
    type: 'TEMPLATE',
  }
  fixture.messages.push(latest)
  fixture.conversation.lastMessageAt = latest.createdAt
  fixture.conversation.lastMessagePreview = 'Template: cake_ready_update'
  const messageRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/conversations\/.+\/messages$/.test(path)) messageRequests.push(path)
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const rows = page.getByRole('list', { name: 'Conversation list' }).getByRole('button')
  try {
    await expect(rows.first()).toContainText(`You: ${body}`, { timeout: 15_000 })
  } catch (error) {
    throw new Error(`${String(error)}\nBrowser errors: ${browserErrors.join('\n')}`)
  }
  await expect(rows.first().locator('[data-status="READ"]')).toBeVisible()
  await expect(rows.nth(1)).toContainText('Template · cake ready update')
  expect(messageRequests.every((path) => path.includes('/review/'))).toBe(true)
  await rows.first().hover()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'rendered-template-preview-1440.png') })

  const failed = {
    ...fixture.message(
      'latest-failed-document',
      'OUTBOUND',
      {
        type: 'DOCUMENT',
        fileId: 'file',
        filename: 'Very-long-quotation-filename-for-delivery-confirmation.pdf',
      },
      -1,
    ),
    type: 'DOCUMENT',
    status: 'FAILED',
    errorDetail: 'Customer unreachable',
  }
  fixture.messages.push(failed)
  fixture.conversation.lastMessageAt = failed.createdAt
  fixture.conversation.lastMessagePreview = 'Document'
  await page.reload()
  await expect(rows.first()).toContainText('Failed')
  await expect(rows.first()).toContainText(
    'You: Very-long-quotation-filename-for-delivery-confirmation.pdf',
  )
  await expect(rows.first()).toHaveAttribute('aria-current', 'true')
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'failed-document-preview-1440.png') })
})

test('centre composer uses one controlled countdown, exact thresholds, safe expiry and compact layout', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const fixture = await inboxFixture(page)
  const duration = 61 * 60_000
  const expires = fixture.setWindow(duration)
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'preview-tenant',
          name: 'Preview workspace',
          timezone: 'America/New_York',
          country: 'US',
          currency: 'USD',
        },
      },
    }),
  )
  const start = Date.parse(expires) - duration
  await page.clock.install({ time: new Date(start) })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const chat = page.getByRole('region', { name: 'Conversation', exact: true })
  const strip = chat.getByRole('group', { name: 'Conversation state' })
  const input = chat.getByRole('textbox', { name: 'Reply', exact: true })
  const composer = chat.locator('.fw-inbox-composer')
  const indicator = () =>
    composer.getByRole('button', { name: /left\. Free-form replies available until/ })
  await expect(indicator()).toContainText('1h left')
  await expect(strip).not.toContainText(/window|left/i)
  expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(36)
  expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(40)
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(48)
  expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(136)
  await indicator().focus()
  await expect(page.getByRole('tooltip')).toContainText('Free-form replies available until')
  await expect(indicator()).toHaveAttribute('aria-label', /[AP]M/)
  await expect(indicator()).toHaveAttribute('aria-label', /\b(?:EDT|EST)\b/)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'centre-normal-1440.png') })
  await input.fill('Preserve this reply through expiry')
  await page.clock.fastForward(60_000)
  await expect(indicator()).toContainText('60m left')
  await expect(
    chat.getByText('Reply window closes soon. Templates remain available afterward.'),
  ).toHaveCount(0)
  await page.clock.fastForward(45 * 60_000)
  await expect(indicator()).toContainText('15m left')
  await expect(
    chat.getByText('Reply window closes soon. Templates remain available afterward.'),
  ).toBeVisible()
  await expect(indicator().locator('[data-slot="badge"]')).toHaveClass(/bg-warning-soft/)
  await expect(chat.getByText(/The 24-hour window closes in/)).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'centre-imminent-1440.png') })
  await chat.getByRole('tab', { name: 'Internal note', exact: true }).click()
  await expect(indicator()).toHaveCount(0)
  await expect(chat.getByText(/Reply window closes soon/)).toHaveCount(0)
  const note = chat.getByRole('textbox', { name: 'Internal note', exact: true })
  await note.fill('Private draft')
  await expect(chat.getByRole('button', { name: 'Add note' })).toBeEnabled()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'centre-note-1440.png') })
  await chat.getByRole('tab', { name: 'Reply', exact: true }).click()
  await expect(input).toHaveValue('Preserve this reply through expiry')
  await page.clock.fastForward(14 * 60_000)
  await expect(indicator()).toContainText('1m left')
  fixture.close()
  await page.clock.fastForward(60_000)
  await expect(chat.getByRole('button', { name: 'Choose template' })).toBeVisible()
  await expect(chat.getByText('0m left')).toHaveCount(0)
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
  await expect(composer.locator('[aria-live="polite"]').first()).toContainText(
    'Reply window closed',
  )
  await expect(
    chat.getByText('Choose an approved template to message this customer.', { exact: true }),
  ).toBeVisible()
  expect(fixture.sent).toHaveLength(0)
  const extended = fixture.setWindow(23 * 3600_000 + 61 * 60_000)
  await page.clock.setSystemTime(new Date(Date.parse(extended) - 60_000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(input).toHaveValue('Preserve this reply through expiry')
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(input).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (shots) await page.screenshot({ path: join(shots, `centre-responsive-${width}.png`) })
  }
  await page.setViewportSize({ width: 375, height: 600 })
  await expect(input).toBeInViewport()
  await page.addStyleTag({ content: 'html { font-size: 20px; }' })
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('centre eligibility checking, restrictions and send rejection preserve drafts and note permission', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const fixture = await inboxFixture(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/contacts/customer/eligibility*', async (route) => {
    await gate
    await route.fallback()
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const chat = page.getByRole('region', { name: 'Conversation', exact: true })
  const input = chat.getByRole('textbox', { name: 'Reply', exact: true })
  await input.fill('Draft before eligibility is known')
  await expect(chat.getByText('Checking eligibility…')).toBeVisible()
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(chat.getByRole('button', { name: 'Send a template' })).toBeDisabled()
  await chat.getByRole('tab', { name: 'Internal note', exact: true }).click()
  await expect(chat.getByText('Checking eligibility…')).toHaveCount(0)
  await chat.getByRole('textbox', { name: 'Internal note', exact: true }).fill('Notes are separate')
  await expect(chat.getByRole('button', { name: 'Add note', exact: true })).toBeEnabled()
  await chat.getByRole('tab', { name: 'Reply', exact: true }).click()
  release()
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  fixture.rejectNextSend('CONVERSATION_WINDOW_CLOSED')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(chat.getByRole('button', { name: 'Choose template' })).toBeVisible()
  await expect(
    page.getByText(
      'Reply window closed. Your draft is saved; choose an approved template to continue.',
    ),
  ).toBeVisible()
  fixture.setWindow(30 * 60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(input).toHaveValue('Draft before eligibility is known')
  fixture.rejectNextSend('CONTACT_BLOCKED')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(input).toHaveValue('Draft before eligibility is known')
  fixture.restrict('CONTACT_BLOCKED', 'This contact is blocked.')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(chat.getByText('This contact is blocked.', { exact: true })).toBeVisible()
  await expect(chat.getByText('Reply window closed', { exact: true })).toHaveCount(0)
  await expect(chat.getByRole('button', { name: 'Choose template' })).toHaveCount(0)
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'centre-restricted-1440.png') })
})

test('centre automation strip uses the existing action and prevents repeated resume clicks', async ({
  page,
}) => {
  const fixture = await inboxFixture(page)
  fixture.conversation.automationState = 'AGENT_TAKEOVER'
  let release!: () => void
  let calls = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/conversations/review/automation-state', async (route) => {
    calls++
    await gate
    fixture.conversation.automationState = route.request().postDataJSON().state
    await route.fulfill({ json: { data: fixture.conversation } })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const strip = page.getByRole('group', { name: 'Conversation state' })
  await expect(strip).toContainText('Automation paused')
  await expect(strip).not.toContainText('Agent takeover')
  const resume = strip.getByRole('button', { name: 'Resume automation' })
  await resume.click()
  await expect(resume).toBeDisabled()
  await resume.evaluate((el) => (el as HTMLButtonElement).click())
  await expect.poll(() => calls).toBe(1)
  release()
  await expect(strip).toContainText('Automation active')
  await strip.getByRole('button', { name: 'Take over', exact: true }).click()
  await expect(strip).toContainText('Automation paused')
  await expect.poll(() => calls).toBe(2)
  await expect(strip).not.toContainText(/window|left/i)
})

test('customer panel keeps avatar identity, copies phone accessibly and reuses the contact editor', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const fixture = await inboxFixture(page)
  fixture.customer.name = 'Textile Demo Shopper 79'
  fixture.fields.language = 'en'
  fixture.fields.country = 'IN'
  fixture.fields.properties = {
    vip: false,
    delivery_note: 'Please use the side entrance for deliveries. '.repeat(5),
  }
  await page.route('**/api/v1/contact-properties', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'vip',
            key: 'vip',
            label: 'VIP customer',
            type: 'BOOLEAN',
            required: false,
            archived: false,
            options: null,
          },
          {
            id: 'delivery',
            key: 'delivery_note',
            label: 'Delivery instructions',
            type: 'TEXT',
            required: false,
            archived: false,
            options: null,
          },
        ],
      },
    }),
  )
  await page.addInitScript(() => {
    const state = window as typeof window & { copiedPhone?: string; denyCopy?: boolean }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (state.denyCopy) throw new Error('Clipboard unavailable')
          state.copiedPhone = value
        },
      },
    })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const profile = panel.getByLabel('Customer identity', { exact: true })
  await expect(
    profile.getByRole('heading', { name: 'Textile Demo Shopper 79', exact: true }),
  ).toBeVisible()
  const listAvatar = page
    .getByRole('list', { name: 'Conversation list' })
    .getByRole('button')
    .first()
    .locator('[data-slot="avatar"]')
    .first()
  const profileAvatar = profile.locator('[data-slot="avatar"]').first()
  await expect(listAvatar).toHaveText('79')
  await expect(profileAvatar).toHaveText('79')
  const color = await listAvatar
    .locator('span')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  await expect(profileAvatar.locator('span')).toHaveCSS('background-color', color)
  await expect(profile.getByRole('link', { name: 'Open contact' })).toHaveAttribute(
    'href',
    '/contacts/customer',
  )
  await profile.getByRole('button', { name: 'Copy phone number' }).click()
  await expect(page.getByText('Phone number copied', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => (window as typeof window & { copiedPhone?: string }).copiedPhone),
  ).toBe(fixture.customer.phoneE164)
  await page.evaluate(() => {
    ;(window as typeof window & { denyCopy?: boolean }).denyCopy = true
  })
  await profile.getByRole('button', { name: 'Copy phone number' }).click()
  await expect(
    page.getByText('Couldn’t copy the phone number. Select and copy it manually.'),
  ).toBeVisible()
  const fields = panel.getByRole('region', { name: 'Contact fields' })
  await expect(fields.getByText('India', { exact: true })).toBeVisible()
  await expect(fields.getByText('No', { exact: true })).toBeVisible()
  await expect(fields.getByText('Delivery instructions', { exact: true })).toBeVisible()
  const reply = page.getByRole('textbox', { name: 'Reply', exact: true })
  await reply.fill('Keep this customer-panel draft')
  await profile.getByRole('button', { name: 'Edit contact', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit contact', exact: true })
  await expect(editor).toBeVisible()
  await editor
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('delivery.team@example.com')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(fields).toContainText('delivery.team@example.com')
  await expect(reply).toHaveValue('Keep this customer-panel draft')
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'customer-identity-fields-1440.png') })
  await page.addStyleTag({ content: 'html { font-size: 20px; }' })
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(
    panel.getByRole('heading', { name: 'Textile Demo Shopper 79', exact: true }),
  ).toBeVisible()
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'customer-scaled-text-1440.png') })
  await page.addStyleTag({ content: 'html { font-size: 16px; }' })
  await panel.getByRole('button', { name: 'Close contact details' }).click()
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(fields).toContainText('delivery.team@example.com')
  await page.setViewportSize({ width: 375, height: 900 })
  await page.getByRole('button', { name: 'Show contact details' }).click()
  const drawer = page.getByRole('dialog', { name: 'Customer details' })
  await expect(drawer.getByRole('heading', { name: 'Textile Demo Shopper 79' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'customer-drawer-375.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Show contact details' })).toBeFocused()
  await expect(reply).toHaveValue('Keep this customer-panel draft')
})

test('customer assignment, wrapping tags and complete contact notes keep their working mutations', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const fixture = await inboxFixture(page)
  fixture.conversation.assignee = null
  fixture.tags.push({
    id: 'vip',
    name: 'VIP delivery follow-through for a very long category label',
    color: 'PRIMARY',
  })
  const body = 'Confirm the preferred delivery time before sending the driver. '.repeat(12)
  fixture.contactNotes.splice(
    0,
    fixture.contactNotes.length,
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `note-${index}`,
      body: index === 0 ? body : `Recorded customer note ${index}`,
      authorId: 'preview-user',
      authorName: 'Priya',
      createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    })),
  )
  let assignRelease!: () => void
  let assignCalls = 0
  const assignGate = new Promise<void>((resolve) => {
    assignRelease = resolve
  })
  await page.route('**/api/v1/conversations/review/assign', async (route) => {
    assignCalls++
    await assignGate
    await route.fallback()
  })
  let noteRelease!: () => void
  let noteCalls = 0
  const noteGate = new Promise<void>((resolve) => {
    noteRelease = resolve
  })
  await page.route('**/api/v1/contacts/customer/notes', async (route) => {
    if (route.request().method() === 'POST') {
      noteCalls++
      await noteGate
    }
    await route.fallback()
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const assignment = panel.getByRole('region', { name: 'Assignment' })
  await assignment.getByRole('button', { name: 'Unassigned. Choose an assignee' }).click()
  await page.getByRole('menuitem', { name: /Arun Kumar/ }).click()
  await expect(
    assignment.getByRole('button', { name: 'Unassigned. Choose an assignee' }),
  ).toBeDisabled()
  await expect.poll(() => assignCalls).toBe(1)
  assignRelease()
  await expect(
    assignment.getByRole('button', { name: 'Assigned to Arun Kumar. Change assignee' }),
  ).toBeVisible()
  await assignment.getByRole('button', { name: 'Assign to me', exact: true }).click()
  await expect(
    assignment.getByRole('button', { name: 'Assigned to Priya. Change assignee' }),
  ).toBeVisible()
  const tags = panel.getByRole('region', { name: 'Tags' })
  await tags.getByRole('button', { name: 'Add tag', exact: true }).click()
  await page.getByRole('menuitem', { name: fixture.tags[2]!.name, exact: true }).click()
  await expect(tags).toContainText(fixture.tags[2]!.name)
  await tags.getByRole('button', { name: 'Remove tag Follow-up' }).click()
  await expect(tags.getByText('Follow-up', { exact: true })).toHaveCount(0)
  const notes = panel.getByRole('region', { name: 'Contact notes' })
  await expect(notes.getByRole('heading', { name: 'Notes (6)' })).toBeVisible()
  await expect(notes.getByRole('listitem')).toHaveCount(3)
  const longNote = notes.getByRole('listitem').first()
  const before = (await longNote.boundingBox())!.height
  await longNote.getByRole('button', { name: 'Expand note by Priya' }).click()
  expect((await longNote.boundingBox())!.height).toBeGreaterThan(before)
  await expect(longNote.getByRole('button', { name: 'Collapse note by Priya' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await longNote.getByRole('button', { name: 'Collapse note by Priya' }).click()
  await notes.getByRole('button', { name: 'Show all 6 notes' }).click()
  await expect(notes.getByRole('listitem')).toHaveCount(6)
  await notes.getByRole('button', { name: 'Add note', exact: true }).click()
  await notes.getByRole('textbox', { name: 'New contact note' }).fill('Call before delivery.')
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled()
  await notes.locator('form').dispatchEvent('submit')
  await expect.poll(() => noteCalls).toBe(1)
  noteRelease()
  await expect(notes.getByRole('heading', { name: 'Notes (7)' })).toBeVisible()
  await expect(notes.getByText('Call before delivery.', { exact: true })).toBeVisible()
  expect(await axe(page)).toEqual([])
  const scroll = panel.locator(':scope > div').last()
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  expect(
    (await panel.getByRole('tablist', { name: 'Contact panel' }).boundingBox())!.y,
  ).toBeLessThan((await panel.boundingBox())!.y + 70)
  await scroll.evaluate((el) => {
    el.scrollTop = 0
  })
  if (shots) await page.screenshot({ path: join(shots, 'customer-notes-tags-1440.png') })
})

test('read-only customer fields and eligibility remain truthful while unknown, closed or blocked', async ({
  page,
}) => {
  const fixture = await inboxFixture(page, { writable: false, assignment: false })
  fixture.customer.name = null
  fixture.fields.email = null
  fixture.fields.language = null
  fixture.contactNotes.splice(0)
  fixture.conversation.automationState = 'AUTOMATION_ACTIVE'
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/contacts/customer/eligibility*', async (route) => {
    await gate
    await route.fallback()
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  await expect(
    panel.getByRole('heading', { name: fixture.customer.phoneE164, exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', {
      name: /Edit contact|Add email|Set language|Add note|Remove tag|Change assignee/,
    }),
  ).toHaveCount(0)
  await expect(panel.getByText('No notes yet.', { exact: true })).toBeVisible()
  const eligibility = panel.getByRole('button', { name: 'Messaging eligibility', exact: true })
  await expect(eligibility).toHaveAttribute('aria-expanded', 'false')
  await expect(eligibility).toContainText('Checking…')
  await expect(panel.getByText('Can reply', { exact: true })).toHaveCount(0)
  fixture.close()
  release()
  await expect(eligibility).toContainText('Templates only')
  await eligibility.click()
  const detail = panel.getByRole('region', { name: 'Messaging eligibility', exact: true })
  await expect(detail.getByText('Not recorded', { exact: true })).toHaveCount(2)
  await expect(panel.getByRole('button', { name: 'Choose template' })).toHaveCount(0)
  await expect(panel.getByText(/\d+[hm] left/)).toHaveCount(0)
  fixture.restrict('CONTACT_BLOCKED', 'This contact is blocked.')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(eligibility).toContainText('Unavailable')
  await expect(detail.getByText('This contact is blocked.', { exact: true }).first()).toBeVisible()
  const automation = panel.getByRole('button', { name: 'Automation', exact: true })
  await expect(automation).toContainText('Active')
  fixture.conversation.automationState = 'AGENT_TAKEOVER'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(automation).toContainText('Paused for agent')
  await automation.click()
  await expect(panel.getByRole('button', { name: 'Resume automation' })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'customer-read-only-1440.png') })
})

test('customer activity pages recorded events without changing the chat history or scroll anchor', async ({
  page,
}) => {
  test.setTimeout(120000)
  const fixture = await inboxFixture(page)
  const at = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString()
  fixture.activities.push(
    ...Array.from({ length: 55 }, (_, i): ContactActivity => ({
      id: `tag-${i}`,
      type: 'tag.added',
      actorType: 'USER',
      actorId: 'preview-user',
      actorName: 'Priya',
      data: { tag: `Recorded tag ${i}` },
      occurredAt: at(i + 2),
    })),
    {
      id: 'old-note',
      type: 'note.added',
      actorType: 'USER',
      actorId: 'preview-user',
      actorName: 'Priya',
      data: { noteId: 'older-note' },
      occurredAt: at(80),
    },
  )
  const history = Array.from({ length: 100 }, (_, i) =>
    fixture.message(
      `activity-history-${i}`,
      'INBOUND',
      { type: 'TEXT', text: `History ${i}` },
      i + 1,
    ),
  )
  Object.assign(history[0]!, {
    direction: 'SYSTEM',
    type: 'SYSTEM_EVENT',
    content: {
      type: 'SYSTEM_EVENT',
      event: 'assigned',
      data: { actorName: 'Priya', toName: 'Arun Kumar' },
    },
  })
  Object.assign(history[89]!, {
    direction: 'SYSTEM',
    type: 'SYSTEM_EVENT',
    content: {
      type: 'SYSTEM_EVENT',
      event: 'automation_resumed',
      data: { actorName: 'Priya' },
    },
  })
  const cursors: string[] = []
  await page.route('**/api/v1/conversations/review/messages?**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('type') || url.searchParams.has('kind')) return route.fallback()
    const before = url.searchParams.get('before')
    if (before) cursors.push(before)
    await route.fulfill({
      json: {
        data: history.slice(before ? 50 : 0, before ? 100 : 50),
        page: { nextCursor: before ? null : 'message-older' },
      },
    })
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let failed = false
  await page.route('**/api/v1/contacts/customer/activities**', async (route) => {
    await gate
    if (failed)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
      })
    await route.fallback()
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const log = page.getByRole('log', { name: 'Messages' })
  await expect(log.getByText('History 1', { exact: true })).toBeAttached()
  await log.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect(log.getByText('History 49', { exact: true })).toBeInViewport()
  const anchor = await log.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight }))
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('Keep this activity draft')
  await panel.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(panel.getByText('No activity yet.', { exact: true })).toHaveCount(0)
  release()
  const activity = panel.getByRole('region', { name: 'Customer activity' })
  await expect(activity.getByText('Assigned to Arun Kumar', { exact: true })).toBeVisible()
  await expect(activity.getByText('Contact note added', { exact: true })).toHaveCount(0)
  await activity.getByRole('button', { name: 'Load earlier activity' }).click()
  await expect(activity.getByText('Contact note added', { exact: true })).toBeVisible()
  await expect(activity.getByText('Automation resumed', { exact: true })).toBeVisible()
  await expect(activity.getByRole('button', { name: 'Load earlier activity' })).toHaveCount(0)
  expect(cursors).toEqual(['message-older'])
  const times = await activity.locator('time').evaluateAll((els) => els.map((el) => el.dateTime))
  expect(times).toEqual([...times].sort().reverse())
  expect(await log.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight }))).toEqual(
    anchor,
  )
  await expect(reply).toHaveValue('Keep this activity draft')
  expect(await axe(page)).toEqual([])
  await panel
    .locator(':scope > div')
    .last()
    .evaluate((el) => {
      el.scrollTop = 0
    })
  if (shots) await page.screenshot({ path: join(shots, 'customer-activity-1440.png') })
  failed = true
  await page.reload()
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(panel.getByText('Activity couldn’t be loaded', { exact: true })).toBeVisible({
    timeout: 15000,
  })
  failed = false
  await panel.getByRole('button', { name: 'Try again' }).click()
  await expect(panel.getByText('Assigned to Arun Kumar', { exact: true })).toBeVisible()
})

test('customer files keep loading, recovery, open and jump actions with the reply draft', async ({
  page,
}) => {
  await inboxFixture(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let failed = false
  await page.route('**/api/v1/conversations/review/messages?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('type') !== 'document')
      return route.fallback()
    await gate
    if (failed)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
      })
    await route.fallback()
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('Keep this files draft')
  await expect(panel.getByText('Quotation-Q-00003.pdf', { exact: true })).toHaveCount(0)
  await panel.getByRole('tab', { name: 'Files', exact: true }).click()
  await expect(panel.getByText('No images in this conversation', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: /Documents/ }).click()
  await expect(panel.getByText('No documents in this conversation', { exact: true })).toHaveCount(0)
  release()
  const file = panel.getByRole('link', { name: 'Quotation-Q-00003.pdf', exact: true })
  await expect(file).toBeVisible()
  await expect(panel).toContainText('248 KB')
  const popup = page.waitForEvent('popup')
  await file.click()
  const opened = await popup
  await expect(opened).toHaveURL(/brand\/apple-icon.png/)
  await opened.close()
  await panel.getByRole('button', { name: 'Jump to message' }).click()
  await expect(page.locator('[data-message-id="document"]')).toBeFocused()
  await expect(reply).toHaveValue('Keep this files draft')
  expect(await axe(page)).toEqual([])
  if (shots) await page.screenshot({ path: join(shots, 'customer-files-1440.png') })
  failed = true
  await page.reload()
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
  await panel.getByRole('button', { name: /Documents/ }).click()
  await expect(panel.getByText('Media couldn’t be loaded', { exact: true })).toBeVisible({
    timeout: 15000,
  })
  failed = false
  await panel.getByRole('button', { name: 'Try again' }).click()
  await expect(file).toBeVisible()
})

test('switching customers during a slow response keeps details and drafts scoped to each contact', async ({
  page,
}) => {
  const fixture = await inboxFixture(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/contacts/customer', async (route) => {
    await gate
    await route.fallback()
  })
  const secondContact = { ...fixture.customer, id: 'contact-6', name: 'Anitha' }
  const second = { ...fixture.conversation, id: 'other-6', contact: secondContact }
  await page.route('**/api/v1/conversations/other-6**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/messages'))
      return route.fulfill({ json: { data: [], page: { nextCursor: null } } })
    const data = path.endsWith('/notes')
      ? []
      : path.endsWith('/media-counts')
        ? { all: 0, image: 0, video: 0, document: 0, audio: 0, template: 0 }
        : path.endsWith('/compose-lock')
          ? { conversationId: second.id, holder: null, expiresAt: null }
          : second
    await route.fulfill({ json: { data } })
  })
  await page.route('**/api/v1/contacts/contact-6**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/eligibility')) {
      const verdict = { allowed: true, reason: null, code: null, optedOut: false }
      return route.fulfill({
        json: {
          data: {
            freeform: verdict,
            utilityTemplate: verdict,
            marketingTemplate: verdict,
            serviceWindowExpiresAt: second.serviceWindow.expiresAt,
          },
        },
      })
    }
    const data = path.endsWith('/contact-6')
      ? {
          ...secondContact,
          email: 'anitha@example.test',
          language: null,
          country: null,
          properties: {},
          tags: [],
          marketingConsent: 'NONE',
          utilityConsent: 'NONE',
        }
      : []
    await route.fulfill({ json: { data, page: { nextCursor: null } } })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/inbox?c=review')
  const panel = page.getByRole('complementary', { name: 'Customer details' })
  const reply = page.getByLabel('Reply', { exact: true })
  await expect(panel.getByRole('heading', { name: 'Vijay', exact: true })).toBeVisible()
  await reply.fill('Vijay draft')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await list.getByText('Anitha', { exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'Anitha', exact: true })).toBeVisible()
  await expect(panel.getByText('anitha@example.test', { exact: true })).toBeVisible()
  await expect(reply).toHaveValue('')
  await reply.fill('Anitha draft')
  const oldResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/contacts/customer',
  )
  release()
  await oldResponse
  await expect(panel.getByText('vijay@example.com', { exact: true })).toHaveCount(0)
  await expect(panel.getByText('anitha@example.test', { exact: true })).toBeVisible()
  await expect(reply).toHaveValue('Anitha draft')
  await list.getByText('Vijay', { exact: true }).click()
  await expect(panel.getByText('vijay@example.com', { exact: true })).toBeVisible()
  await expect(reply).toHaveValue('Vijay draft')
})
