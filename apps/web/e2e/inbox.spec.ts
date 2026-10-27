import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  API,
  customerWritesIn,
  linkFromEmail,
  ownerHeaders,
  PASSWORD,
  resetRateLimits,
  signInAsNewOwner,
  uniqueEmail,
} from './support'

test.beforeEach(() => resetRateLimits())

test('two agents: typing locks the reply box for the other, and replies arrive live', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-inbox')
  const customer = await customerWritesIn(page, owner, 'Is the shop open today?')

  // A second agent joins through an invitation, in another browser.
  const agentEmail = uniqueEmail('ui-agent')
  const since = Date.now()
  const invited = await page.request.post(`${API}/team/invitations`, {
    data: { email: agentEmail, role: 'AGENT' },
    headers: ownerHeaders(owner),
  })
  expect(invited.status()).toBe(201)
  const token = (await linkFromEmail(agentEmail, '/invitations/', since)).split('/invitations/')[1]
  const agentPage = await (await browser.newContext()).newPage()
  const accepted = await agentPage.request.post(`${API}/invitations/${token}/accept`, {
    data: { name: 'Priya Agent', password: PASSWORD },
  })
  expect(accepted.status(), await accepted.text()).toBe(200)

  for (const p of [page, agentPage]) {
    await p.goto('/inbox')
    await p.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
    await expect(
      p.getByRole('log', { name: 'Messages' }).getByText('Is the shop open today?'),
    ).toBeVisible()
  }

  await agentPage.getByLabel('Reply', { exact: true }).fill('Yes, until 9 pm')
  await expect(page.getByText('Priya Agent is replying…')).toBeVisible()
  await expect(page.getByLabel('Reply', { exact: true })).toBeDisabled()

  await agentPage.getByLabel('Reply', { exact: true }).press('Enter')
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Yes, until 9 pm'),
  ).toBeVisible()
  await expect(page.getByLabel('Reply', { exact: true })).toBeEnabled()
  await expect(page.getByText('Priya Agent is replying…')).toHaveCount(0)
  // The agent's reply took the conversation over from automation.
  await expect(page.getByRole('group', { name: 'Conversation state' })).toContainText(
    'Agent takeover',
  )

  // The open conversation (all three panes) has no WCAG 2.1 AA violations.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  )
})

test('internal notes, resolve, and the mobile single-pane layout', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-inbox-mobile')
  const customer = await customerWritesIn(page, owner, 'Where is my order?')
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  await expect(page.getByRole('list', { name: 'Conversation list' })).toBeHidden()
  await page.getByRole('button', { name: 'Internal note' }).click()
  await page.getByLabel('Internal note').fill('Checking with the warehouse')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Checking with the warehouse')).toBeVisible()
  await expect(page.getByText(/^Private note ·/)).toBeVisible()
  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(
    page.getByRole('list', { name: 'Conversation list' }).or(page.getByText('Nothing here')),
  ).toBeVisible()
})

test('canned replies: created in settings, inserted with / in the composer, then edited and sent', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-inbox-canned')
  const customer = await customerWritesIn(page, owner, 'Thank you so much!')

  await page.goto('/settings/workspace')
  await page.getByRole('button', { name: 'Add reply' }).click()
  const dialog = page.getByRole('dialog', { name: 'New canned reply' })
  await dialog.getByLabel('Shortcut').fill('/thanks')
  await dialog.getByLabel('Title').fill('Thank you')
  await dialog.getByLabel('Message').fill('You are welcome! Anything else we can help with?')
  await dialog.getByRole('button', { name: 'Add reply' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Canned replies' })
      .getByRole('button', { name: 'Edit /thanks' }),
  ).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])

  await page.goto('/inbox')
  await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
  const reply = page.getByLabel('Reply', { exact: true })
  await reply.fill('/tha')
  const picker = page.getByRole('listbox', { name: 'Canned replies' })
  await expect(picker.getByRole('option', { name: /\/thanks/ })).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
  await reply.press('Enter') // inserts, never sends
  await expect(reply).toHaveValue('You are welcome! Anything else we can help with?')
  await expect(picker).toBeHidden()
  await reply.press('End')
  await reply.type(' 😊')
  await reply.press('Enter')
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Anything else we can help with? 😊'),
  ).toBeVisible()
  await expect(reply).toHaveValue('')
})
