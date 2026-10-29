import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  API,
  MOCK,
  metaId,
  ownerHeaders,
  refreshCsrf,
  resetRateLimits,
  signInAsNewOwner,
} from './support'

test.beforeEach(() => resetRateLimits())
test('Product Enquiry wizard, phone test, published mock conversation and reports at desktop/mobile sizes', async ({
  page,
}) => {
  test.setTimeout(180000)
  const owner = await signInAsNewOwner(page, 'reply-studio-ui')
  await refreshCsrf(page, owner)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] }),
  })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { ...ids, accessToken: `mock-dev:${ids.wabaId}` },
    headers: ownerHeaders(owner),
  })
  expect(connected.status()).toBe(201)
  await page.goto('/automations/reply-studio')
  await page.getByRole('tab', { name: 'Bot Flows', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('link', { name: 'Create Bot Flow', exact: true }).click()
  await page.getByRole('button', { name: /Product Enquiry Collect product/ }).click()
  await page.getByLabel('Name', { exact: true }).fill('Product enquiry wizard')
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    if (i === 0) await expect(page.getByText(/^WhatsApp number:/)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Start test', exact: true }).click()
  await page.getByRole('button', { name: 'Clothing', exact: true }).click()
  for (const value of ['Cotton shirt', 'Blue, size M', '12', '2026-12-15']) {
    await expect(page.getByLabel('Customer answer', { exact: true })).toBeEnabled()
    await page.getByLabel('Customer answer', { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText(/Would hand over the enquiry and add a private note/)).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page).toHaveURL(/\/automations\/reply-studio$/)
  const from = `9196${String(Math.random()).slice(2, 10)}`
  const send = async (text: string) => {
    const res = await fetch(`${MOCK}/__mock/inbound`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: ids.phoneNumberId,
        from,
        name: 'Reply Studio customer',
        text,
      }),
    })
    expect(res.ok).toBe(true)
  }
  await refreshCsrf(page, owner)
  const flowList = await page.request.get(`${API}/flows`, { headers: ownerHeaders(owner) })
  const flowId = (await flowList.json()).data.find(
    (f: { name: string }) => f.name === 'Product enquiry wizard',
  ).id as string
  const waitForNode = async (node: string) => {
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${API}/flows/${flowId}/executions`, {
            headers: ownerHeaders(owner),
          })
          const e = (await r.json()).data[0]
          return e?.status === 'WAITING' ? e.currentNodeId : ''
        },
        { timeout: 30000 },
      )
      .toBe(node)
  }
  await send('enquiry')
  await waitForNode('category')
  for (const [text, node] of [
    ['Clothing', 'product'],
    ['Cotton shirt', 'preference'],
    ['Blue, size M', 'quantity'],
    ['12', 'required_date'],
    ['2026-12-15', 'confirm'],
  ]) {
    await send(text!)
    await waitForNode(node!)
  }
  await send('Confirm')
  await page.goto('/automations/reply-studio/reports')
  await expect(async () => {
    await page.reload()
    const row = page
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: 'Product enquiry wizard' })
    await expect(row.getByRole('cell').nth(1)).toHaveText('1')
    await expect(row.getByRole('cell').nth(2)).toHaveText('1')
    await expect(row.getByRole('cell').nth(4)).toHaveText('1')
    await expect(row.getByRole('cell').nth(6)).toHaveText('0')
  }).toPass({ timeout: 30000 })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  }
})
