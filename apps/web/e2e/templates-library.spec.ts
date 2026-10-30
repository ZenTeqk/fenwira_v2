import AxeBuilder from '@axe-core/playwright'
import { AUTH_BODY_TEXT, type Template, type TemplateComponents } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { mockFrontend } from './frontend-fixture'

// Browser-only fixtures. No sample template data is shipped with the application.
function template(
  name: string,
  status: Template['status'],
  category: Template['category'],
  components: TemplateComponents,
): Template {
  const at = new Date(Date.now() - 3600000).toISOString()
  return {
    id: name,
    name,
    status,
    category,
    language: 'en',
    wabaId: 'account',
    wabaName: 'Review bakery',
    qualityScore: null,
    approvedVersionId: status === 'APPROVED' ? `${name}-v1` : null,
    createdAt: at,
    updatedAt: at,
    currentVersion: {
      id: `${name}-v1`,
      version: 1,
      status,
      components,
      samples: { body: category === 'AUTHENTICATION' ? ['123456'] : ['Asha', 'A-1042'] },
      metaTemplateId: null,
      origin: 'FENWIRA',
      rejectionReason: status === 'REJECTED' ? 'Meta requested a clearer message.' : null,
      lastError: null,
      qualityScore: null,
      submittedAt: null,
      decidedAt: null,
      createdAt: at,
    },
  }
}

test('polished template library preserves identifiers, full previews, filters and accessible responsive cards', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  await mockFrontend(page, ['templates.write'])
  const records = [
    template('order_cancelled', 'APPROVED', 'UTILITY', {
      header: { format: 'TEXT', text: 'Order update' },
      body: { text: 'Hi {{1}}, order {{2}} has been cancelled. Your refund is on its way.' },
      footer: { text: 'Thank you for shopping with us.' },
      buttons: [{ type: 'URL', text: 'View order', url: 'https://example.com/order' }],
    }),
    template('summer_collection', 'PENDING', 'MARKETING', {
      header: { format: 'IMAGE', sampleFileId: 'photo' },
      body: { text: 'Explore our new collection, {{1}}.' },
    }),
    template('verify_login', 'DRAFT', 'AUTHENTICATION', {
      body: { text: AUTH_BODY_TEXT },
      auth: { securityRecommendation: true, codeExpirationMinutes: 10 },
      buttons: [{ type: 'COPY_CODE', example: '123456' }],
    }),
    template('shipment_update', 'REJECTED', 'UTILITY', {
      header: { format: 'DOCUMENT' },
      body: { text: 'Your shipment information is attached.' },
    }),
    template(
      'weekly_offers_for_our_valued_customers_with_a_long_template_identifier',
      'PAUSED',
      'MARKETING',
      {
        header: { format: 'VIDEO' },
        body: { text: 'Watch this week’s offers.' },
      },
    ),
    template('delivery_reminder', 'APPROVED', 'UTILITY', {
      body: {
        text: `${'Your delivery details are recorded here.\n'.repeat(24)}Complete delivery instructions.`,
      },
      footer: { text: 'Contact the team for assistance.' },
      buttons: [{ type: 'QUICK_REPLY', text: 'Confirm delivery' }],
    }),
  ]
  let syncCalls = 0
  const queries: string[] = []
  await page.route('**/api/v1/templates**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/templates/sync')) {
      syncCalls++
      return route.fulfill({ json: { data: [{ imported: 0, updated: 1 }] } })
    }
    if (url.pathname.endsWith('/templates/samples/photo/url'))
      return route.fulfill({ json: { data: { url: '/brand/apple-icon.png' } } })
    if (!url.pathname.endsWith('/templates')) return route.fallback()
    queries.push(url.search)
    const q = url.searchParams.get('q') ?? ''
    const data = records.filter(
      (t) =>
        t.name.includes(q) &&
        ['category', 'language', 'status'].every(
          (key) =>
            !url.searchParams.has(key) ||
            t[key as 'category' | 'language' | 'status'] === url.searchParams.get(key),
        ),
    )
    await route.fulfill({ json: { data } })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/templates')
  const library = page.getByRole('list', { name: 'Template library' })
  await expect(library.getByRole('link', { name: 'Order cancelled', exact: true })).toHaveAttribute(
    'href',
    '/templates/order_cancelled',
  )
  await expect(library.getByText('order_cancelled', { exact: true })).toBeVisible()
  await expect(library.getByText('Asha', { exact: true })).toHaveCount(2)
  await expect(library.getByText('document header', { exact: true })).toBeVisible()
  await expect(library.getByText('video header', { exact: true })).toBeVisible()
  await expect(library.getByRole('img', { name: 'Header sample' })).toBeVisible()
  const screenshot = (name: string) =>
    page.screenshot({
      path: process.env.TEMPLATES_SHOTS_DIR
        ? join(process.env.TEMPLATES_SHOTS_DIR, name)
        : info.outputPath(name),
      fullPage: true,
    })
  for (const [width, columns] of [
    [1440, 3],
    [1024, 2],
    [768, 2],
    [375, 1],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await library.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
    ).toBe(columns)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const stage of await library.locator('.fw-template-library-preview').all())
      expect((await stage.boundingBox())!.height).toBe(192)
    expect(
      await library.evaluate((el) =>
        [...el.querySelectorAll('*')].some(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight,
        ),
      ),
    ).toBe(false)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await screenshot(`templates-polished-${width}.png`)
  }
  const preview = page.getByRole('button', { name: 'Preview delivery_reminder', exact: true })
  await preview.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: 'delivery_reminder', exact: true })
  await expect(drawer.getByRole('figure', { name: 'Message preview' })).toContainText(
    'Complete delivery instructions.',
  )
  await expect(drawer.getByRole('list', { name: 'Buttons' })).toContainText('Confirm delivery')
  await page.keyboard.press('Escape')
  await expect(preview).toBeFocused()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Sync with WhatsApp' }).click()
  await expect.poll(() => syncCalls).toBe(1)
  await expect(page.getByText('Synced from Meta: 0 new, 1 updated')).toBeVisible()
  await page.getByRole('tab', { name: /^In review/ }).click()
  await expect(
    library.getByRole('listitem').filter({ has: page.locator('[data-template-card]') }),
  ).toHaveCount(1)
  await expect(library.getByText('summer_collection', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: /^All/ }).click()
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Authentication', exact: true }).click()
  await expect(library.getByRole('link', { name: 'Verify login' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Approved/ })).toContainText('0')
  expect(queries.some((query) => query.includes('category=AUTHENTICATION'))).toBe(true)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('order_cancelled')
  await expect(library.getByRole('link', { name: 'Order cancelled', exact: true })).toBeVisible()
  await expect(library.getByText('summer_collection', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create template', exact: true })).toHaveAttribute(
    'href',
    '/templates/new',
  )
})
