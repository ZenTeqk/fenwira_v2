import { CAMPAIGN_STATUSES, type Campaign, type Template } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { API, metaId, MOCK, ownerHeaders, signInAsNewOwner } from './support'

const products = [
  ['Organic Cotton Collection', 'DRAFT', 'COTTON', 'Soft everyday fabrics'],
  ['Pongal Silk Saree Festival', 'SCHEDULED', 'SILK SAREES', 'Celebrate in timeless silk'],
  ['Summer Linen Collection', 'PREPARING', 'LINEN', 'Light and breathable styles'],
  ['Festive Cotton Saree Offers', 'RUNNING', 'FESTIVE', 'Colourful cotton sarees'],
  ['Kids Ethnic Wear Launch', 'PAUSED', 'KIDS WEAR', 'Comfort for every celebration'],
  [
    'Bridal Kanjivaram Collection',
    'PAUSED_INSUFFICIENT_FUNDS',
    'BRIDAL SILK',
    'Traditional woven elegance',
  ],
  [
    'Designer Kurti New Arrivals',
    'PAUSED_TEMPLATE_UNAVAILABLE',
    'KURTIS',
    'Fresh prints and easy fits',
  ],
  ['Handloom Bedsheet Collection', 'COMPLETED', 'HANDLOOM', 'Bring comfort home'],
  ['Denim Weekend Collection', 'CANCELLED', 'DENIM', 'Everyday wardrobe essentials'],
  ['Winter Shawl Collection', 'FAILED', 'SHAWLS', 'Warm layers for cooler days'],
] as const

/** Local fixture artwork; no generated artwork or sample names are added to the application. */
function textileArtwork(index: number, headline: string, description: string) {
  const colors = ['#713449', '#245e59', '#253d75', '#9b5426', '#624373']
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <defs><pattern id="weave" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0H12M0 0V12" stroke="white" opacity=".1"/></pattern></defs>
    <rect width="640" height="360" fill="${colors[index % colors.length]}"/><rect width="640" height="360" fill="url(#weave)"/>
    <text x="28" y="42" fill="#fff" font-family="Arial" font-size="18">FENWIRA TEXTILES · LOCAL DEMO</text>
    <text x="28" y="117" fill="#ffdda0" font-family="Arial" font-size="39" font-weight="bold">${headline}</text>
    <text x="28" y="158" fill="#fff" font-family="Arial" font-size="20">${description}</text>
    <path d="M370 205l92-29 123 35-75 107-116-16z" fill="#efcba9"/><path d="M404 209l75-22 78 33-63 80-90-16z" fill="#a9d6cd"/>
    <path d="M417 211l57-16 62 31-48 57-71-15z" fill="#e79193"/>
    <path d="M429 211l46-10 39 23-35 41-50-13z" fill="url(#weave)" stroke="#ffdda0"/>
    <text x="28" y="245" fill="#fff" font-family="Arial" font-size="24">Discover your next favourite</text>
    <text x="28" y="280" fill="#ffdda0" font-family="Arial" font-size="18">Explore our textile collection</text>
    <text x="28" y="329" fill="#fff" font-family="Arial" font-size="13">Synthetic visual review · No real customer sends</text>
  </svg>`
}

// Only this new demo tenant's four unlaunched fixtures are initialized. RLS remains enforced.
const seedRareStates = String.raw`
const { Database } = require('@fenwira/database');
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (process.env.WHATSAPP_DEV_CONNECT !== 'true' || process.env.META_GRAPH_BASE_URL !== 'http://fenwira-meta-mock:4200') throw Error('Local mock required');
const db = Database.connect({ url: process.env.DATABASE_URL });
(async () => { try {
  await db.withTenant(payload.tenantId, async tx => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: payload.tenantId } });
    if (tenant.name !== 'Fenwira Textiles — Local Demo') throw Error('Wrong workspace');
    const allowed = new Set(['PREPARING','PAUSED_INSUFFICIENT_FUNDS','PAUSED_TEMPLATE_UNAVAILABLE','FAILED']);
    for (const item of payload.items) {
      if (!allowed.has(item.status)) throw Error('Unsupported fixture state');
      const c = await tx.campaign.findFirstOrThrow({ where: { id: item.id, status: 'DRAFT', name: item.name } });
      const now = new Date();
      const snapshotted = item.status.startsWith('PAUSED');
      if (snapshotted) {
        const contacts = await tx.contact.findMany({ where: { id: { in: payload.contactIds } }, take: 8 });
        if (contacts.length !== 8) throw Error('Demo contacts missing');
        await tx.campaignRecipient.createMany({ data: contacts.map(contact => ({ tenantId: payload.tenantId, campaignId: c.id, contactId: contact.id, phoneE164: contact.phoneE164, contactName: contact.name, variables: { body: [] }, status: 'PENDING' })) });
      }
      await tx.campaign.update({ where: { id: c.id }, data: {
        status: item.status, templateSnapshot: item.snapshot, launchedBy: c.createdBy, launchedAt: now,
        audienceSnapshotAt: snapshotted ? now : null, totalRecipients: snapshotted ? 8 : 0,
        startedAt: snapshotted ? now : null, pausedAt: snapshotted ? now : null,
        failedAt: item.status === 'FAILED' ? now : null,
        failureReason: item.status === 'FAILED' ? 'Local demo fixture: audience preparation failed before sending.' : null,
      } });
      await tx.auditLog.create({ data: { tenantId: payload.tenantId, actorType: 'USER', actorId: c.createdBy, action: 'demo.campaign.state_seeded', targetType: 'campaign', targetId: c.id, changes: { before: 'DRAFT', after: item.status, reason: 'Synthetic textile visual-review fixture; no financial operation or customer send.' } } });
    }
  });
} finally { await db.disconnect(); } })().catch(() => { console.error('Demo fixture initialization failed'); process.exitCode = 1; });
`

test('create ten textile demo campaigns covering every supported status', async ({
  page,
}, info) => {
  test.skip(process.env.CREATE_TEXTILE_DEMOS !== 'true', 'Explicit local demo creation only')
  test.setTimeout(240_000)
  for (const url of [API, MOCK]) expect(['localhost', '127.0.0.1']).toContain(new URL(url).hostname)
  const owner = await signInAsNewOwner(page, 'textile-demo', 'Fenwira Textiles — Local Demo')
  const headers = ownerHeaders(owner),
    wabaId = metaId(),
    phoneNumberId = metaId()
  expect(
    (
      await fetch(`${MOCK}/__mock/seed`, {
        method: 'POST',
        body: JSON.stringify({
          wabaId,
          name: 'Fenwira Textiles Demo',
          phones: [
            { id: phoneNumberId, verifiedName: 'Fenwira Textiles', display: '+1 555-010-2027' },
          ],
        }),
      })
    ).ok,
  ).toBe(true)
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    headers,
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
  })
  expect(connected.status()).toBe(201)
  const phoneId = (await connected.json()).data.id
  const accounts = (await (await page.request.get(`${API}/templates/accounts`, { headers })).json())
    .data
  const accountId = accounts.find(
    (account: { metaWabaId: string }) => account.metaWabaId === wabaId,
  ).id
  const tag = await page.request.post(`${API}/tags`, {
    headers,
    data: { name: 'Textile shoppers', color: 'PRIMARY' },
  })
  expect(tag.status()).toBe(201)
  const tagId = (await tag.json()).data.id
  const contactIds: string[] = []
  for (let index = 0; index < 80; index++) {
    const contact = await page.request.post(`${API}/contacts`, {
      headers,
      data: {
        name: `Textile Demo Shopper ${index + 1}`,
        phone: `+9194119900${String(index).padStart(2, '0')}`,
        tagIds: [tagId],
        consents: [
          {
            purpose: 'MARKETING',
            status: 'GRANTED',
            source: 'MANUAL',
            note: 'Synthetic local textile demo; mock only',
          },
        ],
      },
    })
    expect(contact.status()).toBe(201)
    contactIds.push((await contact.json()).data.id)
  }
  const artwork = await page.context().newPage()
  const created: Array<{ campaign: Campaign; template: Template; status: string }> = []
  for (const [index, [name, status, headline, description]] of products.entries()) {
    await artwork.setViewportSize({ width: 640, height: 360 })
    await artwork.setContent(
      `<style>body{margin:0}</style>${textileArtwork(index, headline, description)}`,
    )
    const png = await artwork.screenshot()
    const upload = await page.request.post(`${API}/templates/samples/upload-url`, {
      headers,
      data: { mimeType: 'image/png', sizeBytes: png.length, filename: `textile-demo-${index}.png` },
    })
    expect(upload.status()).toBe(201)
    const file = (await upload.json()).data
    expect((await page.request.put(file.url, { headers: file.headers, data: png })).ok()).toBe(true)
    expect(
      (
        await page.request.post(`${API}/templates/samples/${file.fileId}/complete`, { headers })
      ).ok(),
    ).toBe(true)
    const response = await page.request.post(`${API}/templates`, {
      headers,
      data: {
        wabaId: accountId,
        name: `textile_demo_${index}`,
        language: 'en',
        category: 'MARKETING',
        components: {
          header: { format: 'IMAGE', sampleFileId: file.fileId },
          body: {
            text: `${description}. Discover ${name.toLowerCase()} at Fenwira Textiles. Browse colours, fabrics and sizes in our collection.`,
          },
          buttons: [
            {
              type: 'URL',
              text: 'View textile collection',
              url: 'https://example.com/textile-demo',
            },
          ],
        },
        samples: { body: [] },
      },
    })
    expect(response.status()).toBe(201)
    const template = (await response.json()).data as Template
    expect(
      (
        await page.request.post(`${API}/templates/${template.id}/submit`, {
          headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        })
      ).ok(),
    ).toBe(true)
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${API}/templates/${template.id}`, { headers })).json())
            .data.status,
        { timeout: 30000 },
      )
      .toBe('APPROVED')
    const draft = await page.request.post(`${API}/campaigns`, {
      headers,
      data: {
        name,
        phoneNumberId: phoneId,
        templateVersionId: template.currentVersion.id,
        audience: {
          include:
            status === 'RUNNING' || status === 'PREPARING'
              ? [{ kind: 'TAGS', tagIds: [tagId], match: 'ANY' }]
              : [{ kind: 'CONTACTS', contactIds: contactIds.slice(0, 8) }],
          exclude: [],
        },
        variableMapping: { body: [] },
        rateLimitPerMinute: status === 'RUNNING' || status === 'PAUSED' ? 1 : null,
        ...(['SCHEDULED', 'CANCELLED'].includes(status)
          ? { scheduleAt: new Date(Date.now() + 7 * 86400000).toISOString() }
          : {}),
      },
    })
    expect(draft.status(), await draft.text()).toBe(201)
    created.push({ campaign: (await draft.json()).data, template, status })
  }
  await artwork.close()
  const launch = async (id: string) => {
    const result = await page.request.post(`${API}/campaigns/${id}/launch`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(result.ok(), await result.text()).toBe(true)
  }
  const completed = created.find((row) => row.status === 'COMPLETED')!
  await launch(completed.campaign.id)
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${API}/campaigns/${completed.campaign.id}`, { headers })
          ).json()
        ).data.status,
      { timeout: 30000 },
    )
    .toBe('COMPLETED')
  for (const row of created.filter((row) => ['SCHEDULED', 'CANCELLED'].includes(row.status))) {
    await launch(row.campaign.id)
    if (row.status === 'CANCELLED')
      expect(
        (await page.request.post(`${API}/campaigns/${row.campaign.id}/cancel`, { headers })).ok(),
      ).toBe(true)
  }
  const paused = created.find((row) => row.status === 'PAUSED')!
  await launch(paused.campaign.id)
  expect(
    (await page.request.post(`${API}/campaigns/${paused.campaign.id}/pause`, { headers })).ok(),
  ).toBe(true)
  expect(
    (
      await fetch(`${MOCK}/__mock/delay`, {
        method: 'POST',
        body: JSON.stringify({ pathContains: `${phoneNumberId}/messages`, ms: 10000, times: 160 }),
      })
    ).ok,
  ).toBe(true)
  const running = created.find((row) => row.status === 'RUNNING')!
  await launch(running.campaign.id)
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${API}/campaigns/${running.campaign.id}`, { headers })
          ).json()
        ).data.status,
      { timeout: 30000 },
    )
    .toBe('RUNNING')
  const rare = created.filter((row) =>
    ['PREPARING', 'PAUSED_INSUFFICIENT_FUNDS', 'PAUSED_TEMPLATE_UNAVAILABLE', 'FAILED'].includes(
      row.status,
    ),
  )
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', '-w', '/repo/apps/api', 'fenwira-api', 'node', '-e', seedRareStates],
    {
      cwd: resolve(__dirname, '../../..'),
      input: JSON.stringify({
        tenantId: owner.tenantId,
        contactIds: contactIds.slice(0, 8),
        items: rare.map((row) => ({
          id: row.campaign.id,
          name: row.campaign.name,
          status: row.status,
          snapshot: {
            templateId: row.template.id,
            versionId: row.template.currentVersion.id,
            name: row.template.name,
            language: row.template.language,
            category: row.template.category,
            components: row.template.currentVersion.components,
          },
        })),
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const rows = (await (await page.request.get(`${API}/campaigns`, { headers })).json())
    .data as Campaign[]
  expect(rows).toHaveLength(10)
  expect(rows.map((row) => row.status).sort()).toEqual([...CAMPAIGN_STATUSES].sort())
  writeFileSync(
    info.outputPath('textile-demo.json'),
    JSON.stringify(
      {
        workspace: owner.workspaceName,
        email: owner.email,
        tenantId: owner.tenantId,
        simulatedOnly: true,
        capturedAt: new Date().toISOString(),
        campaigns: rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          fixtureState: rare.some((item) => item.campaign.id === row.id),
        })),
        transientStates: ['PREPARING', 'RUNNING'],
        note: 'Four rare lifecycle states use audited, tenant-scoped fixture initialization. No wallet operations or enforcement changes.',
      },
      null,
      2,
    ),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/campaigns')
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible()
  await expect(page.locator('[data-campaign-card]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Show more campaigns', exact: true })).toBeVisible()
  while (await page.getByRole('button', { name: 'Show more campaigns', exact: true }).count())
    await page.getByRole('button', { name: 'Show more campaigns', exact: true }).click()
  await expect(page.locator('[data-campaign-card]')).toHaveCount(6)
  await expect(page.locator('[data-campaign-card] img')).toHaveCount(6)
  await expect
    .poll(() =>
      page
        .locator('[data-campaign-card] img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)
  await page.screenshot({
    path: info.outputPath('textile-campaigns-all-statuses.png'),
    fullPage: true,
  })
})
