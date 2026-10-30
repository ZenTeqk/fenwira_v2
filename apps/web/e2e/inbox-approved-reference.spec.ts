import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { mockFrontend } from './frontend-fixture'

// Browser-only review fixtures. No example customer data ships with the application.
async function inboxFixture(page: Page) {
  await mockFrontend(page, [
    'inbox.read',
    'inbox.reply',
    'inbox.reassign',
    'contacts.read',
    'contacts.write',
  ])
  const now = Date.now()
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString()
  const expires = new Date(now + 23 * 3600000).toISOString()
  const tags = [
    { id: 'cake', name: 'Cake order', color: 'PRIMARY' },
    { id: 'follow', name: 'Follow-up', color: 'WARNING' },
  ]
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
    assignee: { id: 'preview-user', name: 'Priya' },
    status: 'OPEN',
    automationState: 'AUTOMATION_PAUSED',
    tags,
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
  const message = (id: string, direction: string, content: object, minutes: number) => ({
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
    templateSnapshot: null,
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
  }
  let paginated = false
  let closed = false
  let fail = false
  let empty = false
  const sent: unknown[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/v1', '')
    let data: unknown
    const current = {
      ...conversation,
      serviceWindow: { isOpen: !closed, expiresAt: closed ? at(60) : expires },
    }
    if (path === '/conversations/counts') data = { all: 24, mine: 8, unassigned: 4 }
    else if (path === '/conversations') {
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        })
      const names = [
        'Vijay',
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
        contact: { ...customer, id: `contact-${index}`, name },
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
    else if (path === '/conversations/review/messages') {
      if (route.request().method() === 'POST') {
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
    else if (path === '/contacts/customer')
      data = {
        ...customer,
        ...fields,
        country: null,
        tags,
        properties: {},
        marketingConsent: 'NONE',
        utilityConsent: 'NONE',
      }
    else if (path === '/contacts/customer/eligibility')
      data = {
        freeform: { allowed: !closed, reason: closed ? 'Reply window closed' : null },
        utilityTemplate: { allowed: true },
        marketingTemplate: { allowed: false, reason: 'Consent unknown' },
        serviceWindowExpiresAt: expires,
      }
    else if (path === '/contacts/customer/notes')
      data = [
        {
          id: 'contact-note',
          body: 'Prefers evening delivery.',
          authorName: 'Priya',
          createdAt: at(20),
        },
      ]
    else if (path === '/contacts/customer/conversations') data = []
    else if (path === '/inbox/presence')
      data = [{ userId: 'preview-user', name: 'Priya', status: 'ONLINE' }]
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
    sent,
    customer,
    fields,
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
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled()
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
      await expect(panel).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Contact details' })).toHaveCount(0)
      expect((await panel.boundingBox())!.x).toBeGreaterThan(
        (await page.getByRole('region', { name: 'Conversation', exact: true }).boundingBox())!.x,
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(await axe(page)).toEqual([])
      if (shots) await page.screenshot({ path: join(shots, 'inbox-docked-1024.png') })
      await panel.getByRole('button', { name: 'Close contact details' }).click()
      await expect(panel).toBeHidden()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await axe(page)).toEqual([])
    if (shots) await page.screenshot({ path: join(shots, `inbox-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Show contact details' }).click()
  await expect(page.getByRole('dialog', { name: 'Contact details' })).toBeVisible()
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
  await expect(panel).toContainText('Email not provided')
  await expect(panel).toContainText('Language not provided')
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
  await page.route('**/api/v1/conversations/counts*', (route) =>
    route.fulfill({ json: { data: { all: 80, mine: 0, unassigned: 80 } } }),
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
    expect((await views.boundingBox())!.height).toBeLessThanOrEqual(width >= 640 ? 33 : 37)
    expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(width >= 640 ? 42 : 46)
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
  const takeover = controls.getByRole('button', { name: 'Agent takeover only', exact: true })
  await takeover.click()
  await expect(takeover).toHaveAttribute('aria-pressed', 'true')
  await takeover.click()
  await expect(takeover).toHaveAttribute('aria-pressed', 'false')
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
    'Hide contact details',
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
  const drawer = page.getByRole('dialog', { name: 'Contact details', exact: true })
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
