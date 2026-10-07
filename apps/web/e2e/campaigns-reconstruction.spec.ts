import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  API,
  linkFromEmail,
  ownerHeaders,
  PASSWORD,
  signInAsNewOwner,
  uniqueEmail,
} from './support'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Campaigns read-only members can inspect operations but cannot create or launch', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'campaigns-reader')
  const created = await page.request.post(`${API}/campaigns`, {
    headers: ownerHeaders(owner),
    data: { name: 'Read-only operations fixture' },
  })
  expect(created.status()).toBe(201)
  const draft = (await created.json()).data
  const email = uniqueEmail('campaigns-viewer'),
    since = Date.now()
  expect(
    (
      await page.request.post(`${API}/team/invitations`, {
        headers: ownerHeaders(owner),
        data: { email, role: 'VIEWER' },
      })
    ).status(),
  ).toBe(201)
  const token = (await linkFromEmail(email, '/invitations/', since)).split('/invitations/')[1]
  const context = await browser.newContext()
  try {
    const viewer = await context.newPage()
    expect(
      (
        await viewer.request.post(`${API}/invitations/${token}/accept`, {
          data: { name: 'Reader', password: PASSWORD },
        })
      ).status(),
    ).toBe(200)
    await viewer.goto('/campaigns')
    await expect(viewer.getByRole('link', { name: draft.name, exact: true })).toBeVisible()
    await expect(viewer.getByRole('link', { name: 'Create campaign', exact: true })).toHaveCount(0)
    await viewer.getByRole('link', { name: draft.name, exact: true }).click()
    await expect(viewer.getByRole('heading', { name: draft.name, level: 1 })).toBeVisible()
    await expect(
      viewer.getByRole('button', {
        name: /Launch campaign|Schedule campaign|Save draft|Pause|Resume/,
      }),
    ).toHaveCount(0)
    const me = (await (await viewer.request.get(`${API}/auth/me`)).json()).data
    const denied = await viewer.request.post(`${API}/campaigns`, {
      headers: { 'X-Tenant-Id': owner.tenantId, 'X-CSRF-Token': me.csrfToken },
      data: { name: 'Forbidden write' },
    })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).error.message).toBe('You do not have permission to do this.')
    await viewer.goto('/campaigns/new')
    await expect(viewer.getByText("You don't have access", { exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page: viewer }).withTags(tags).analyze()).violations).toEqual([])
  } finally {
    await context.close()
  }
})

test('Campaigns loading, first-use, error retry and filtered empty remain actionable', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'campaigns-states')
  await page.goto('/campaigns')
  await expect(page.getByText('Prepare your first campaign', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create your first campaign' })).toBeVisible()
  const created = await page.request.post(`${API}/campaigns`, {
    headers: ownerHeaders(owner),
    data: { name: 'Recovery fixture' },
  })
  expect(created.status()).toBe(201)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/campaigns', async (route) => {
    await gate
    await route.continue()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('Loading campaigns', { exact: true })).toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([])
  release()
  await expect(page.getByRole('link', { name: 'Recovery fixture', exact: true })).toBeVisible()
  await page.unroute('**/api/v1/campaigns')
  await page.route('**/api/v1/campaigns', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Campaign operations unavailable' },
      }),
    }),
  )
  await page.reload()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Campaigns couldn’t be loaded' }),
  ).toBeVisible()
  await page.unroute('**/api/v1/campaigns')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Recovery fixture', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search campaigns' }).fill('No such operation')
  await expect(page.getByText('No matching campaigns', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: /^Clear filters/ })
    .first()
    .click()
  await expect(page.getByRole('link', { name: 'Recovery fixture', exact: true })).toBeVisible()
})
