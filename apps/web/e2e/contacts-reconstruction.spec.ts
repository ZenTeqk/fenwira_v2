import AxeBuilder from '@axe-core/playwright'
import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { type Contact } from '@fenwira/contracts'
import {
  API,
  customerWritesIn,
  ownerHeaders,
  signInAsNewOwner,
  uniqueEmail,
  linkFromEmail,
  PASSWORD,
} from './support'

async function accessible(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0)
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
}

test('Contacts reconstruction uses real identities, compact rows and contextual details at four widths', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const owner = await signInAsNewOwner(page, 'Arun', 'Acme Electronics')
  const headers = ownerHeaders(owner)
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).data
  const tags: string[] = []
  for (const [name, color] of [
    ['New customer', 'PRIMARY'],
    ['Television', 'INFO'],
    ['Festival offer', 'NEUTRAL'],
  ] as const) {
    const response = await page.request.post(`${API}/tags`, { headers, data: { name, color } })
    expect(response.status(), await response.text()).toBe(201)
    tags.push((await response.json()).data.id)
  }
  for (const [index, name] of [
    'ABC Electronics',
    'Anita Rao',
    'Kumar Stores',
    'Suresh Kumar',
    'Lakshmi Traders',
    'Mohan Raj',
    'Vignesh',
    'Revathi',
    'Selvam Electronics',
  ].entries()) {
    const response = await page.request.post(`${API}/contacts`, {
      headers,
      data: {
        name,
        phone: `+91942228810${index}`,
        tagIds: [tags[index % tags.length]],
        ...(index % 3 === 0 ? { ownerId: me.user.id } : {}),
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  const incoming = await customerWritesIn(page, owner, 'Can you share the television details?')
  let priya!: Contact
  await expect
    .poll(async () => {
      const data = (
        await (
          await page.request.post(`${API}/contacts/search`, { headers, data: { q: incoming } })
        ).json()
      ).data as Contact[]
      priya = data[0]!
      return !!priya
    })
    .toBe(true)
  const updated = await page.request.patch(`${API}/contacts/${priya.id}`, {
    headers,
    data: {
      name: 'Priya Sharma',
      email: 'priya@example.test',
      language: 'en',
      country: 'IN',
      ownerId: me.user.id,
    },
  })
  expect(updated.ok(), await updated.text()).toBe(true)
  for (const tagId of tags)
    expect(
      (
        await page.request.post(`${API}/contacts/bulk`, {
          headers,
          data: { action: 'TAG', contactIds: [priya.id], tagId },
        })
      ).ok(),
    ).toBe(true)
  expect(
    (
      await page.request.post(`${API}/contacts/${priya.id}/consents`, {
        headers,
        data: { purpose: 'MARKETING', status: 'GRANTED', note: 'Synthetic review fixture opt-in' },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/contacts')
  await expect(page.getByText('10 contacts · Page 1', { exact: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: /^Priya Sharma(?: \+[\d ]+)?$/ })
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await accessible(page)
    if (width === 375) {
      await expect(page.getByRole('table', { name: 'Contacts', exact: true })).toBeHidden()
      await expect(page.getByRole('list', { name: 'Contacts', exact: true })).toBeVisible()
      expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(40)
    }
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const context = page.getByRole(width === 1440 ? 'complementary' : 'dialog', {
      name: 'Priya Sharma',
      exact: true,
    })
    await expect(context.getByRole('link', { name: 'Message', exact: true })).toBeVisible()
    await expect(context.getByRole('region', { name: 'Contact information' })).toContainText(
      'priya@example.test',
    )
    await expect(context.getByRole('region', { name: 'Contact tags' })).toContainText('Television')
    await context.getByText('Eligibility and consent details', { exact: true }).click()
    await expect(context.getByRole('region', { name: 'Messaging eligibility' })).toContainText(
      'Free-form replies',
    )
    await accessible(page)
    await page.screenshot({
      path: info.outputPath(`contacts-context-${width}.png`),
      // A fixed drawer is reviewed within its viewport, not against offscreen page content.
      fullPage: width === 1440,
    })
    if (width === 1440) {
      const geometry = await page.evaluate(() => {
        const box = (e: Element | null) => {
          const b = e?.getBoundingClientRect()
          return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
        }
        return {
          sidebar: box(document.querySelector('aside')),
          topbar: box(document.querySelector('header')),
          row: box(document.querySelectorAll('[data-contact-row]')[1] ?? null),
          selectedRow: box(document.querySelector('[data-contact-row][data-state=selected]')),
          avatar: box(document.querySelector('[data-contact-row] [data-slot=avatar]')),
          context: box(document.querySelector('aside[aria-label="Contact details"]')),
          header: box(document.querySelector('[data-slot=page-header]')),
          directory: box(document.querySelector('[aria-label="Contact directory"]')),
        }
      })
      expect(geometry.sidebar?.width).toBe(68)
      expect(geometry.topbar?.height).toBe(56)
      expect(geometry.row?.height).toBeGreaterThanOrEqual(52)
      expect(geometry.row?.height).toBeLessThanOrEqual(60)
      expect(geometry.avatar?.width).toBe(36)
      expect(geometry.context?.width).toBe(288)
      writeFileSync(
        info.outputPath('contacts-geometry-1440.json'),
        JSON.stringify(geometry, null, 2),
      )
      await context.getByText('Eligibility and consent details', { exact: true }).click()
      await page.screenshot({
        path: info.outputPath('contacts-context-compact-1440.png'),
        fullPage: true,
      })
    }
    // Keep focus within the context before Escape (disclosure click may move it).
    await page.keyboard.press('Escape')
    await expect(context).toBeHidden()
    await expect(trigger).toBeFocused()
    if (width === 375) {
      const actions = page.getByRole('button', { name: 'Actions for Priya Sharma', exact: true })
      await actions.click()
      await page.getByRole('menuitem', { name: 'Quick view', exact: true }).click()
      await expect(context).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(actions).toBeFocused()
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await trigger.click()
  const panel = page.getByRole('complementary', { name: 'Priya Sharma', exact: true })
  await panel.getByRole('button', { name: 'More', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'More', exact: true })).toBeFocused()
  await panel.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit contact', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit contact', exact: true })
  await edit.getByLabel('Email', { exact: true }).fill('priya.updated@example.test')
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(edit).toBeHidden()
  await expect(panel.getByRole('region', { name: 'Contact information' })).toContainText(
    'priya.updated@example.test',
  )
  await panel.getByRole('button', { name: 'More', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.setViewportSize({ width: 375, height: 1000 })
  await expect(page.getByRole('dialog', { name: 'Priya Sharma', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const selected = page.getByRole('checkbox', { name: 'Select Priya Sharma', exact: true })
  await selected.check()
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected')
  await page
    .getByRole('region', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Tags', exact: true })
    .click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: 'New customer', exact: true }).last().click()
  await expect(page.getByText('Updated 1 contacts', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await page.getByRole('combobox', { name: 'Filter by assignment' }).click()
  await page.getByRole('option', { name: 'Assigned to me', exact: true }).click()
  await expect(page.getByText('4 contacts match · Page 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Clear filters/ }).click()
  await page.getByRole('combobox', { name: 'Filter by tag' }).click()
  await page.getByRole('option', { name: 'Television', exact: true }).click()
  await expect(page.getByText('4 contacts match · Page 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Clear filters/ }).click()
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Phone', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: 'Phone', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Phone', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: 'Phone', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('no matching person')
  await expect(page.getByText('No contacts match', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Clear filters/ }).click()
  await expect(trigger).toBeVisible()
})

test('Contacts read-only members see customer context without write/import/export actions', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'contacts-reader')
  const response = await page.request.post(`${API}/contacts`, {
    headers: ownerHeaders(owner),
    data: { name: 'Read-only contact', phone: '+919422277001' },
  })
  expect(response.status()).toBe(201)
  const email = uniqueEmail('contacts-viewer'),
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
    await viewer.goto('/contacts')
    await expect(viewer.getByRole('button', { name: 'Add contact', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('checkbox')).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Read-only contact', exact: true }).click()
    const panel = viewer.getByRole('complementary', { name: 'Read-only contact' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await accessible(viewer)
  } finally {
    await context.close()
  }
})

test('Contacts directory meets the Lighthouse accessibility gate', async ({ page }) => {
  test.skip(
    process.env.EV2_CONTACTS_LIGHTHOUSE !== 'true',
    'Set EV2_CONTACTS_LIGHTHOUSE=true for the explicit audit',
  )
  test.setTimeout(90_000)
  const owner = await signInAsNewOwner(page, 'contacts-lighthouse')
  for (const [phone, name] of [
    ['+919422299001', 'Priya Shah'],
    ['+919422299002', 'Kumar Stores'],
  ]) {
    expect(
      (
        await page.request.post(`${API}/contacts`, {
          headers: ownerHeaders(owner),
          data: { phone, name },
        })
      ).status(),
    ).toBe(201)
  }
  const directory = resolve(__dirname, '../test-results/contacts-lighthouse')
  mkdirSync(directory, { recursive: true })
  const profile = resolve(directory, 'chrome-profile')
  const output = resolve(directory, 'result.json')
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--remote-debugging-port=9337', '--remote-debugging-address=127.0.0.1'],
  })
  try {
    await context.addCookies(await page.context().cookies())
    const base = test.info().project.use.baseURL ?? 'http://localhost:3000'
    await promisify(execFile)(
      'pnpm',
      [
        'dlx',
        'lighthouse@12.8.2',
        `${base}/contacts`,
        '--port=9337',
        '--only-categories=accessibility',
        '--output=json',
        `--output-path=${output}`,
        '--quiet',
        '--disable-storage-reset',
      ],
      { cwd: resolve(__dirname, '../../..'), timeout: 60_000 },
    )
    const report = JSON.parse(readFileSync(output, 'utf8'))
    expect(new URL(report.finalDisplayedUrl).pathname).toBe('/contacts')
    const score = report.categories.accessibility.score * 100
    const failing = Object.entries(report.audits)
      .filter(([, audit]) => (audit as { score: number | null }).score === 0)
      .map(([id]) => id)
    expect(score).toBeGreaterThanOrEqual(95)
    expect(failing).toEqual([])
    writeFileSync(
      resolve(directory, 'scores.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          lighthouse: '12.8.2',
          category: 'accessibility',
          finalUrlsVerified: true,
          scores: [{ path: '/contacts', score, failing }],
        },
        null,
        2,
      ),
    )
  } finally {
    await context.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(output, { force: true })
  }
})
