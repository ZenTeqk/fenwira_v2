import AxeBuilder from '@axe-core/playwright'
import { type Campaign, type Template } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { API, metaId, MOCK, ownerHeaders, signInAsNewOwner } from './support'

const DEMOS = [
  ['Diwali Electronics Offer', 'Festive specials on electronics', 'DIWALI', 'SPECIAL OFFERS'],
  ['Weekend Sale', 'Weekend special discounts', 'WEEKEND', 'SALE'],
  ['October Offers', 'October special offers', 'OCTOBER', 'OFFERS'],
  ['Product Launch', 'Discover our latest electronics', 'NEW', 'ARRIVALS'],
  ['Payment Reminder', 'An update about your pending order', 'ORDER', 'UPDATE'],
  ['Back to School', 'School essentials and accessories', 'BACK TO', 'SCHOOL'],
  ['Festive Reminder', 'Last chance to explore festive offers', 'FESTIVE', 'REMINDER'],
  ['Customer Appreciation', 'A thank you to our customers', 'THANK', 'YOU'],
  ['New Arrivals', 'Explore our latest collection', 'NEW', 'COLLECTION'],
  ['Service Reminder', 'Keep your appliances running smoothly', 'SERVICE', 'REMINDER'],
  ['Loyalty Rewards', 'Special offers for returning customers', 'LOYALTY', 'REWARDS'],
  ['Year End Preview', 'A preview of our year end collection', 'YEAR END', 'PREVIEW'],
]

/** Original vector demo artwork, rendered to PNG for the existing header sample upload. */
function banner(index: number, title: string, subtitle: string) {
  const palettes = [
    ['#8a1818', '#e5a326'],
    ['#074b70', '#c2eff2'],
    ['#1749a8', '#e7b72c'],
  ]
  const [background, accent] = palettes[index % palettes.length]!
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="bg"><stop stop-color="${background}"/><stop offset="1" stop-color="#18201d"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#bg)"/>
    <circle cx="600" cy="30" r="155" fill="${accent}" opacity=".2"/>
    <circle cx="20" cy="350" r="95" fill="${accent}" opacity=".15"/>
    <text x="35" y="45" font-family="Arial,sans-serif" font-size="15" fill="white">ACME ELECTRONICS · DEMO</text>
    <text x="35" y="130" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="${accent}">${title}</text>
    <text x="35" y="180" font-family="Arial,sans-serif" font-size="38" font-weight="bold" fill="white">${subtitle}</text>
    <rect x="425" y="200" width="175" height="102" rx="8" fill="#101517" stroke="${accent}" stroke-width="6"/>
    <rect x="438" y="211" width="149" height="78" rx="3" fill="${accent}" opacity=".7"/>
    <path d="M438 280l35-52 30 34 36-40 48 67H438z" fill="white" opacity=".55"/>
    <path d="M512 304v20m-34 0h69" stroke="${accent}" stroke-width="8"/>
    <path d="M50 278q40 50 80 0z" fill="${accent}"/><path d="M90 272q-20-25 0-45q20 20 0 45" fill="#ffd891"/>
    <text x="155" y="280" font-family="Arial,sans-serif" font-size="19" fill="white">Discover more with us</text>
    <text x="155" y="310" font-family="Arial,sans-serif" font-size="14" fill="white" opacity=".7">Synthetic local review content</text>
  </svg>`
}

test('Campaigns populated reference review with ten additional persisted demo campaigns', async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  expect(['localhost', '127.0.0.1']).toContain(new URL(API).hostname)
  expect(['localhost', '127.0.0.1']).toContain(new URL(MOCK).hostname)
  const owner = await signInAsNewOwner(
    page,
    'campaign-visual-demo',
    'Acme Electronics — Campaign Demo',
  )
  const headers = ownerHeaders(owner)
  const wabaId = metaId(),
    phoneNumberId = metaId()
  expect(
    (
      await fetch(`${MOCK}/__mock/seed`, {
        method: 'POST',
        body: JSON.stringify({
          wabaId,
          name: 'Acme Electronics Demo',
          phones: [
            { id: phoneNumberId, verifiedName: 'Acme Electronics', display: '+1 555-010-2026' },
          ],
        }),
      })
    ).ok,
  ).toBe(true)
  const connection = await page.request.post(`${API}/whatsapp/connections/dev`, {
    headers,
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
  })
  expect(connection.status(), await connection.text()).toBe(201)
  const phoneId = (await connection.json()).data.id
  const accounts = (await (await page.request.get(`${API}/templates/accounts`, { headers })).json())
    .data
  const accountId = accounts.find(
    (account: { metaWabaId: string }) => account.metaWabaId === wabaId,
  ).id
  const tag = await page.request.post(`${API}/tags`, {
    headers,
    data: { name: 'Festival Leads', color: 'PRIMARY' },
  })
  expect(tag.status()).toBe(201)
  const tagId = (await tag.json()).data.id
  const audienceTags: string[] = []
  for (const name of ['All Customers', 'TV Leads', 'School Customers']) {
    const response = await page.request.post(`${API}/tags`, {
      headers,
      data: { name, color: 'PRIMARY' },
    })
    expect(response.status()).toBe(201)
    audienceTags.push((await response.json()).data.id)
  }
  for (let i = 0; i < 80; i++) {
    const response = await page.request.post(`${API}/contacts`, {
      headers,
      data: {
        name: `Demo Customer ${i + 1}`,
        phone: `+9194008800${String(i).padStart(2, '0')}`,
        tagIds: i < 8 ? [tagId, ...audienceTags] : [tagId],
        consents: [
          {
            purpose: 'MARKETING',
            status: 'GRANTED',
            source: 'MANUAL',
            note: 'Synthetic local demo; simulated Meta only',
          },
        ],
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  const artwork = await page.context().newPage()
  const campaigns: Campaign[] = []
  for (const [index, [name, description, headline, subhead]] of DEMOS.entries()) {
    await artwork.setViewportSize({ width: 640, height: 360 })
    await artwork.setContent(`<style>body{margin:0}</style>${banner(index, headline!, subhead!)}`)
    const png = await artwork.screenshot()
    const upload = await page.request.post(`${API}/templates/samples/upload-url`, {
      headers,
      data: {
        mimeType: 'image/png',
        sizeBytes: png.length,
        filename: `campaign-demo-${index}.png`,
      },
    })
    expect(upload.status(), await upload.text()).toBe(201)
    const file = (await upload.json()).data
    expect((await page.request.put(file.url, { headers: file.headers, data: png })).ok()).toBe(true)
    const complete = await page.request.post(`${API}/templates/samples/${file.fileId}/complete`, {
      headers,
    })
    expect(complete.status(), await complete.text()).toBe(200)
    expect((await complete.json()).data.status).toBe('READY')
    const created = await page.request.post(`${API}/templates`, {
      headers,
      data: {
        wabaId: accountId,
        name: `demo_${name!.toLowerCase().replaceAll(' ', '_')}`,
        category: 'MARKETING',
        language: 'en',
        components: {
          header: { format: 'IMAGE', sampleFileId: file.fileId },
          body: { text: `${description}. Explore our collection at Acme Electronics.` },
          buttons: [{ type: 'URL', text: 'View collection', url: 'https://example.com/demo' }],
        },
        samples: { body: [] },
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    const template = (await created.json()).data as Template
    const submitted = await page.request.post(`${API}/templates/${template.id}/submit`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(submitted.ok(), await submitted.text()).toBe(true)
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${API}/templates/${template.id}`, { headers })).json())
            .data.status,
        { timeout: 30_000 },
      )
      .toBe('APPROVED')
    const response = await page.request.post(`${API}/campaigns`, {
      headers,
      data: {
        name,
        phoneNumberId: phoneId,
        templateVersionId: template.currentVersion.id,
        audience: {
          include:
            index < 2
              ? [{ kind: 'TAGS', tagIds: [tagId], match: 'ANY' }]
              : [
                  {
                    kind: 'TAGS',
                    tagIds: [audienceTags[index % audienceTags.length]],
                    match: 'ANY',
                  },
                ],
          exclude: [],
        },
        variableMapping: { body: [] },
        ...(index === 0 ? { rateLimitPerMinute: 1 } : {}),
        ...(index === 1 ? { scheduleAt: new Date(Date.now() + 86_400_000).toISOString() } : {}),
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const campaign = (await response.json()).data as Campaign
    campaigns.push(campaign)
    if (index === 0 || index === 11) continue // Launch the live demo after preparing its history.
    const launched = await page.request.post(`${API}/campaigns/${campaign.id}/launch`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(launched.status(), await launched.text()).toBe(200)
    if (index === 10) {
      expect(
        (await page.request.post(`${API}/campaigns/${campaign.id}/cancel`, { headers })).ok(),
      ).toBe(true)
    } else if (index > 1) {
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${API}/campaigns/${campaign.id}`, { headers })).json())
              .data.status,
          { timeout: 30_000 },
        )
        .toBe('COMPLETED')
    }
  }
  await artwork.close()
  // Slow only this synthetic number after its history has completed. The real worker remains unchanged.
  expect(
    (
      await fetch(`${MOCK}/__mock/delay`, {
        method: 'POST',
        body: JSON.stringify({ pathContains: `${phoneNumberId}/messages`, ms: 10_000, times: 80 }),
      })
    ).ok,
  ).toBe(true)
  const running = await page.request.post(`${API}/campaigns/${campaigns[0]!.id}/launch`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(running.status(), await running.text()).toBe(200)
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${API}/campaigns/${campaigns[0]!.id}/stats`, { headers })
          ).json()
        ).data.sent,
      { timeout: 70_000 },
    )
    .toBeGreaterThan(0)
  const persisted = (await (await page.request.get(`${API}/campaigns`, { headers })).json())
    .data as Campaign[]
  expect(persisted).toHaveLength(12)
  expect(persisted.find((c) => c.id === campaigns[0]!.id)?.status).toBe('RUNNING')
  expect(persisted.find((c) => c.id === campaigns[1]!.id)?.status).toBe('SCHEDULED')
  writeFileSync(
    info.outputPath('demo-workspace.json'),
    JSON.stringify(
      {
        workspace: owner.workspaceName,
        email: owner.email,
        tenantId: owner.tenantId,
        campaigns: persisted.map((c) => ({ name: c.name, status: c.status })),
        simulatedOnly: true,
      },
      null,
      2,
    ),
  )
  await page.goto('/campaigns')
  await page.getByRole('combobox', { name: 'Sort campaigns' }).click()
  await page.getByRole('option', { name: 'Oldest first', exact: true }).click()
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).click()
  const history = page.getByRole('table', { name: 'Campaigns', exact: true })
  await expect(page.getByText('1–5 of 10 loaded campaigns')).toBeVisible()
  await expect(history.getByRole('row')).toHaveCount(6)
  await expect.poll(() => page.locator('[data-campaign-card] img').count()).toBe(2)
  await expect
    .poll(() =>
      page
        .locator('[data-campaign-card] img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await page.screenshot({
      path: info.outputPath(`campaigns-populated-${width}.png`),
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('6–10 of 10 loaded campaigns')).toBeVisible()
  await expect(history.getByRole('row')).toHaveCount(6)
  await expect(history.locator('[data-slot="skeleton"]')).toHaveCount(0)
  await expect.poll(() => history.locator('img').count()).toBeGreaterThanOrEqual(3)
  await expect
    .poll(() =>
      history
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('campaigns-history-page-2.png'), fullPage: true })
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('1–5 of 10 loaded campaigns')).toBeVisible()
  const actions = page.getByRole('button', { name: `Actions for ${campaigns[0]!.name}` })
  await actions.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'View campaign' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()
  // Unavailable media must leave usable campaign identity/actions rather than broken images.
  await page.route('**/api/v1/templates/samples/*/url', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Sample unavailable' } }),
    }),
  )
  await page.reload()
  await expect(page.getByRole('link', { name: campaigns[0]!.name, exact: true })).toBeVisible()
  await expect(page.locator('[data-campaign-card] img')).toHaveCount(0)
  await page.unroute('**/api/v1/templates/samples/*/url')
})
