import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { API, ownerHeaders, signInAsNewOwner } from './support'

const WIDTHS = [1440, 1024, 768, 375]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function accessible(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([])
}

test('Contacts use server eligibility and lightweight context at four widths', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'batch2-contacts', 'Acme Retail')
  for (const [phone, name] of [
    ['+919811100001', 'Priya Shah'],
    ['+919811100002', 'Kumar Stores'],
  ]) {
    const res = await page.request.post(`${API}/contacts`, {
      headers: ownerHeaders(owner),
      data: {
        phone,
        name,
        consents:
          name === 'Priya Shah'
            ? [
                {
                  purpose: 'MARKETING',
                  status: 'GRANTED',
                  source: 'MANUAL',
                  note: 'Synthetic review fixture consent',
                },
              ]
            : [],
      },
    })
    expect(res.status(), await res.text()).toBe(201)
  }
  await page.goto('/contacts')
  await expect(page.getByText('2 contacts', { exact: true })).toBeVisible()
  const table = page.getByRole('table', { name: 'Contacts', exact: true })
  await expect(table.getByText('Marketing allowed')).toBeVisible()
  await expect(table.getByText('Marketing restricted')).toBeVisible()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true })
    const trigger = table.getByRole('button', { name: 'Priya Shah', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Priya Shah', exact: true })
    await expect(drawer.getByRole('region', { name: 'Messaging eligibility' })).toContainText(
      'Free-form replies',
    )
    await expect(drawer.getByText('Contact created', { exact: true })).toBeVisible()
    await accessible(page)
    await page.screenshot({ path: info.outputPath(`contact-context-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const actions = page.getByRole('button', { name: 'Actions for Priya Shah' })
  await actions.click()
  await page.getByRole('menuitem', { name: 'Quick view' }).click()
  await expect(page.getByRole('dialog', { name: 'Priya Shah', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()
})

test('Contacts search errors and eligibility errors stay explicit and retryable', async ({
  page,
}) => {
  const owner = await signInAsNewOwner(page, 'batch2-contact-errors')
  await page.request.post(`${API}/contacts`, {
    headers: ownerHeaders(owner),
    data: { phone: '+919811100003', name: 'Farah Ali' },
  })
  await page.route('**/api/v1/contacts/search', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Contacts temporarily unavailable' },
      }),
    }),
  )
  await page.goto('/contacts')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Contacts temporarily unavailable' }),
  ).toContainText('Contacts temporarily unavailable')
  await page.unroute('**/api/v1/contacts/search')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.route('**/api/v1/contacts/*/eligibility', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Eligibility unavailable' } }),
    }),
  )
  await page.getByRole('button', { name: 'Farah Ali', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Farah Ali' })
  await expect(drawer.getByRole('alert')).toContainText('Eligibility couldn’t be loaded')
  await page.unroute('**/api/v1/contacts/*/eligibility')
  await drawer.getByRole('button', { name: 'Try again' }).click()
  await expect(drawer.getByRole('region', { name: 'Messaging eligibility' })).toBeVisible()
})
