import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  API,
  ownerHeaders,
  resetRateLimits,
  signInAsNewOwner,
  uniqueEmail,
  linkFromEmail,
  PASSWORD,
} from './support'

test.beforeEach(() => resetRateLimits())

test('light automation studio preserves draft editing, responsive settings and retry', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await (async () => {
    if (process.env.EV2_AUTOMATION_TEXTILE_DEMO !== 'true')
      return signInAsNewOwner(page, 'ev2-automation')
    expect(['localhost', '127.0.0.1']).toContain(new URL(String(info.project.use.baseURL)).hostname)
    const fixture = JSON.parse(
      readFileSync(
        resolve('../../docs/design/experience-v2/evidence/textile-campaign-demo/textile-demo.json'),
        'utf8',
      ),
    ) as { email: string; tenantId: string; workspace: string; simulatedOnly: boolean }
    expect(fixture.simulatedOnly).toBe(true)
    expect(fixture.email.endsWith('@fenwira.test')).toBe(true)
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(fixture.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    const me = (await (await page.request.get(`${API}/auth/me`)).json()).data
    expect(me.memberships.some((m: { tenantId: string }) => m.tenantId === fixture.tenantId)).toBe(
      true,
    )
    return {
      email: fixture.email,
      tenantId: fixture.tenantId,
      workspaceName: fixture.workspace,
      csrf: me.csrfToken,
    }
  })()
  const headers = ownerHeaders(owner)
  const tagResponse = await page.request.post(`${API}/tags`, {
    headers,
    data: { name: `Textile enquiry ${Date.now()}`, color: 'PRIMARY' },
  })
  expect(tagResponse.status()).toBe(201)
  const tag = (await tagResponse.json()).data
  const created = await page.request.post(`${API}/flows`, {
    headers,
    data: {
      name: 'Textile enquiry follow-up',
      description: 'Route WhatsApp textile enquiries and welcome interested customers.',
    },
  })
  expect(created.status()).toBe(201)
  const flow = (await created.json()).data
  expect(flow.status).toBe('DRAFT')
  writeFileSync(
    info.outputPath('automation-demo.json'),
    JSON.stringify(
      {
        flowId: flow.id,
        email: owner.email,
        tenantId: owner.tenantId,
        workspace: owner.workspaceName,
        simulatedOnly: true,
        published: false,
      },
      null,
      2,
    ),
  )
  await info.attach('automation-demo.json', {
    body: JSON.stringify(
      {
        flowId: flow.id,
        email: owner.email,
        tenantId: owner.tenantId,
        workspace: owner.workspaceName,
        simulatedOnly: true,
        published: false,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  const draft = (
    await (await page.request.get(`${API}/flows/${flow.id}/draft`, { headers })).json()
  ).data
  const graph = {
    nodes: [
      { id: 'trigger', type: 'trigger.message_received', config: { onlyNewConversation: true } },
      { id: 'check', type: 'condition.has_tag', config: { tagIds: [tag.id], match: 'ANY' } },
      {
        id: 'message',
        type: 'action.send_message',
        config: {
          text: 'Hi {{contact.firstName}} 👋\n\nThanks for your interest in our textile collection. Which fabrics or styles would you like to see?',
        },
      },
      { id: 'wait', type: 'action.delay', config: { amount: 2, unit: 'HOURS' } },
      { id: 'tag', type: 'action.add_tag', config: { tagIds: [tag.id] } },
      { id: 'end', type: 'action.end', config: {} },
      { id: 'other', type: 'action.end', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'check', sourceHandle: 'next' },
      { id: 'e2', source: 'check', target: 'message', sourceHandle: 'yes' },
      { id: 'e3', source: 'check', target: 'other', sourceHandle: 'no' },
      { id: 'e4', source: 'message', target: 'wait', sourceHandle: 'next' },
      { id: 'e5', source: 'wait', target: 'tag', sourceHandle: 'next' },
      { id: 'e6', source: 'tag', target: 'end', sourceHandle: 'next' },
    ],
    layout: {
      trigger: { x: 170, y: 0 },
      check: { x: 170, y: 124 },
      message: { x: 0, y: 248 },
      other: { x: 320, y: 248 },
      wait: { x: 0, y: 372 },
      tag: { x: 0, y: 496 },
      end: { x: 0, y: 620 },
    },
  }
  const saved = await page.request.put(`${API}/flows/${flow.id}/draft`, {
    headers: { ...headers, 'If-Match': draft.etag },
    data: { graph },
  })
  expect(saved.status()).toBe(200)
  await page.goto(`/automations/${flow.id}`)
  await expect(page.getByTestId('flow-node-message')).toBeVisible()
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(7)
  await page.getByTestId('flow-node-message').click()
  await expect(page.getByRole('figure', { name: 'Message preview' })).toContainText(
    '{{contact.firstName}}',
  )
  const library = page.getByRole('navigation', { name: 'Add a step' })
  await library.getByRole('textbox', { name: 'Search steps' }).fill('wait')
  await expect(library.getByRole('button', { name: 'Wait', exact: true })).toBeVisible()
  await expect(library.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0)
  await library.getByRole('textbox', { name: 'Search steps' }).fill('')
  await expect(page.getByText('Customer replied?', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 375) {
      await page.reload()
      await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('button', { name: /^Step 3: Send message/ }).click()
    }
    if (width < 1280)
      await expect(page.getByRole('dialog', { name: 'Step settings', exact: true })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await page.screenshot({ path: info.outputPath(`studio-${width}.png`), fullPage: true })
    if (width < 1280) {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Step settings', exact: true })).toHaveCount(0)
      await expect
        .poll(() => page.evaluate(() => document.activeElement !== document.body))
        .toBe(true)
      await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true })
      if (width !== 375) await page.getByTestId('flow-node-message').click()
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await page.route(`**/api/v1/flows/${flow.id}/draft`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporarily unavailable' } }),
    }),
  )
  await page.reload()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 20_000 })
})

test('read-only automation members cannot edit or publish in the studio', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'ev2-flow-reader')
  const headers = ownerHeaders(owner)
  const created = await page.request.post(`${API}/flows`, {
    headers,
    data: { name: 'Read-only workflow' },
  })
  expect(created.status()).toBe(201)
  const flow = (await created.json()).data
  const email = uniqueEmail('ev2-flow-viewer')
  const since = Date.now()
  expect(
    (
      await page.request.post(`${API}/team/invitations`, {
        headers,
        data: { email, role: 'VIEWER' },
      })
    ).status(),
  ).toBe(201)
  const token = (await linkFromEmail(email, '/invitations/', since)).split('/invitations/')[1]
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    const viewer = await context.newPage()
    expect(
      (
        await viewer.request.post(`${API}/invitations/${token}/accept`, {
          data: { name: 'Flow reader', password: PASSWORD },
        })
      ).status(),
    ).toBe(200)
    await viewer.goto(`/automations/${flow.id}`)
    await expect(viewer.getByRole('heading', { name: flow.name, level: 1 })).toBeVisible()
    await expect(viewer.getByRole('navigation', { name: 'Add a step' })).toHaveCount(0)
    await expect(
      viewer.getByRole('button', { name: /^(Save|Publish|Tidy layout|Add step)$/ }),
    ).toHaveCount(0)
    const me = (await (await viewer.request.get(`${API}/auth/me`)).json()).data
    expect(
      (
        await viewer.request.post(`${API}/flows/${flow.id}/publish`, {
          headers: {
            'X-Tenant-Id': owner.tenantId,
            'X-CSRF-Token': me.csrfToken,
            'Idempotency-Key': crypto.randomUUID(),
          },
          data: {},
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await new AxeBuilder({ page: viewer })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  } finally {
    await context.close()
  }
})
