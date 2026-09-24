import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import {
  API,
  linkFromEmail,
  type Owner,
  PASSWORD,
  resetRateLimits,
  signInAsNewOwner,
  uniqueEmail,
} from './support'

const MOCK = process.env.E2E_META_MOCK_URL ?? 'http://127.0.0.1:4200'
const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)

test.beforeEach(() => resetRateLimits())

const headers = (o: Owner) => ({ 'X-CSRF-Token': o.csrf, 'X-Tenant-Id': o.tenantId })

/** Connects a fresh simulated number and has a customer write in. Returns the customer's name. */
async function customerWritesIn(page: Page, owner: Owner, text: string) {
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers: headers(owner),
  })
  expect(connected.status(), await connected.text()).toBe(201)
  const name = `Customer ${metaId().slice(-4)}`
  const res = await fetch(`${MOCK}/__mock/inbound`, {
    method: 'POST',
    body: JSON.stringify({
      phoneNumberId,
      from: `9195${String(Math.random()).slice(2, 10)}`,
      name,
      text,
    }),
  })
  expect(res.ok).toBe(true)
  return name
}

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
    headers: headers(owner),
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
  await expect(page.getByText('An agent has taken over')).toBeVisible()

  // The open conversation (all three panes) has no WCAG 2.1 AA violations.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
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
  await expect(page.getByText(/^Internal ·/)).toBeVisible()
  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(
    page.getByRole('list', { name: 'Conversation list' }).or(page.getByText('Nothing here')),
  ).toBeVisible()
})
