import { expect, type Page, test } from '@playwright/test'
import { API, customerWritesIn, ownerHeaders, resetRateLimits, signInAsNewOwner } from './support'

/**
 * Visual evidence and responsive checks for Design System v1 (docs/design/UX_PATTERNS.md).
 * Runs only with CAPTURE_DIR set:
 *   CAPTURE_DIR=/tmp/shots pnpm exec playwright test e2e/visual.spec.ts
 * Seeds a workspace (number, conversation, contacts, tag, flow), captures major screens at 1440,
 * 1024, 768 and 375, and asserts no page scrolls horizontally at any width.
 */
const DIR = process.env.CAPTURE_DIR
test.skip(!DIR, 'set CAPTURE_DIR to capture screenshots')

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  // No horizontal page scroll at any width (tables scroll inside their own container).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `${name} scrolls horizontally`).toBeLessThanOrEqual(1)
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false })
}

test('major screens at four widths', async ({ page }) => {
  test.setTimeout(300_000)
  resetRateLimits()
  await page.setViewportSize({ width: 1440, height: 900 })
  const owner = await signInAsNewOwner(page, 'ui-visual', 'Acme Retail')
  const h = { headers: ownerHeaders(owner) }
  const customer = await customerWritesIn(page, owner, 'Hi, is my order #4521 shipped?')
  let contactId = ''
  for (const [name, phone] of [
    ['Asha Rao', '+919812345671'],
    ['Ravi Kumar', '+919812345672'],
    ['Meena Iyer', '+919812345673'],
  ]) {
    const r = await page.request.post(`${API}/contacts`, { data: { name, phone }, ...h })
    contactId ||= ((await r.json()) as { data: { id: string } }).data.id
  }
  await page.request.post(`${API}/tags`, { data: { name: 'VIP', color: 'PRIMARY' }, ...h })
  const flow = await page.request.post(`${API}/flows`, {
    data: { name: 'Order status reply' },
    ...h,
  })
  const flowId = ((await flow.json()) as { data: { id: string } }).data.id

  const pages: Array<[string, string]> = [
    ['dashboard', '/dashboard'],
    ['contacts', '/contacts'],
    ['contact-detail', `/contacts/${contactId}`],
    ['campaigns', '/campaigns'],
    ['campaign-new', '/campaigns/new'],
    ['templates', '/templates'],
    ['template-new', '/templates/new'],
    ['automations', '/automations'],
    ['automation-new', '/automations/new'],
    ['automation-builder', `/automations/${flowId}`],
    ['integrations-whatsapp', '/integrations/whatsapp'],
    ['settings-workspace', '/settings/workspace'],
    ['settings-team', '/settings/team'],
  ]
  for (const [width, height, label] of [
    [1440, 900, 'desktop'],
    [1024, 768, 'laptop'],
    [768, 1024, 'tablet'],
    [375, 812, 'mobile'],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const [name, path] of pages) {
      if (
        label !== 'desktop' &&
        !['dashboard', 'contacts', 'contact-detail', 'automation-builder', 'campaign-new'].includes(
          name,
        )
      )
        continue
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await shot(page, `${label}-${name}`)
    }
    await page.goto('/inbox')
    await page.getByRole('list', { name: 'Conversation list' }).getByText(customer).click()
    await shot(page, `${label}-inbox`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('asha')
  await expect(page.getByRole('option', { name: /Asha Rao/ })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'desktop-command-palette')
  await page.keyboard.press('Escape')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Actions for Ravi Kumar' }).click()
  await page.getByRole('menuitem', { name: 'Quick view' }).click()
  await expect(page.getByRole('region', { name: 'Messaging eligibility' })).toBeVisible()
  await shot(page, 'desktop-contact-drawer')
})
