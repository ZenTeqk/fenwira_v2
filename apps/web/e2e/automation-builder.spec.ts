import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import {
  API,
  type Owner,
  ownerHeaders,
  refreshCsrf,
  resetRateLimits,
  signInAsNewOwner,
} from './support'

/** Guided automation creation: gallery, setup checklist, "+" menu, dry-run tests, publishing. */
test.beforeEach(() => resetRateLimits())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 5).map((n) => n.target),
    })),
  ).toEqual([])
}

async function flowsOf(page: Page, owner: Owner) {
  const res = await page.request.get(`${API}/flows`, { headers: ownerHeaders(owner) })
  return ((await res.json()) as { data: Array<{ id: string; name: string; status: string }> }).data
}

test('pick a template, finish the setup checklist and publish', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'flow-template')
  await page.goto('/automations')
  await expect(page.getByText('No automations yet')).toBeVisible()
  await page.getByRole('link', { name: 'Browse templates' }).click()
  await expect(page.getByRole('heading', { name: 'Create automation', level: 1 })).toBeVisible()
  // AI templates stay visible with the reason when AI Assistant is off for the workspace.
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  const ai = page.getByTestId('template-ai-assistant')
  await expect(ai).toHaveAttribute('aria-disabled', 'true')
  await expect(ai).toContainText('AI Assistant isn’t enabled for this workspace')
  await expectNoViolations(page)

  await page.getByRole('tab', { name: 'Leads' }).click()
  await page.getByTestId('template-lead-capture').click()
  await expect(
    page.getByRole('heading', { name: 'Lead capture and assign', level: 1 }),
  ).toBeVisible()
  await expect(page.getByTestId(/^flow-node-/)).toHaveCount(5)
  await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  const setup = page.getByRole('region', { name: 'Set up your automation' })
  await expect(setup).toContainText('3 of 4 done')
  await expect(page.getByTestId('flow-node-tag')).toContainText('Needs attention')
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await setup.getByRole('button', { name: 'Create the tag “lead”' }).click()
  await expect(setup).toContainText('Everything is set')
  await expect(page.getByTestId('flow-summary')).toHaveText(
    'When a message contains “price”, add the tag lead, assign to whoever is online, then send “Thanks [first name]! A teammate will sh…”.',
  )
  if ((await page.getByRole('tab', { name: 'Ready to publish', exact: true }).count()) === 0)
    await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  await page.getByRole('tab', { name: 'Ready to publish', exact: true }).click()
  await expect(page.getByText('Yes. Every step is set up and connected.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await expectNoViolations(page)

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Publish this automation?' })
    .getByRole('button', { name: 'Publish automation' })
    .click()
  const live = page.getByRole('dialog', { name: 'Your automation is live' })
  await expect(live).toContainText('add the tag lead')
  await expect(live.getByRole('button', { name: 'Test it' })).toBeVisible()
  await live.getByRole('button', { name: 'Done' }).click()
  expect((await flowsOf(page, owner))[0]).toMatchObject({ status: 'ACTIVE' })
  await page.goto('/automations')
  const row = page.getByRole('row', { name: /Lead capture and assign/ })
  await expect(row).toContainText('When a message contains “price”')
  await expect(row).toContainText('Live')
})

test('start from scratch with the "+" menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInAsNewOwner(page, 'flow-scratch')
  await page.goto('/automations/new')
  await page.getByTestId('template-scratch').first().click()
  await expect(page.getByRole('heading', { name: 'Untitled automation', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Add a trigger' }).click()
  const menu = page.getByRole('dialog', { name: 'Add a trigger' })
  await menu.getByRole('button', { name: /^Keyword/ }).click()
  await page.getByLabel('Keywords').fill('hours')
  await page.getByRole('button', { name: 'Add a step after Keyword' }).click()
  const steps = page.getByRole('dialog', { name: 'Add a step' })
  await steps.getByRole('searchbox', { name: 'Search steps' }).fill('send')
  await expect(steps.getByRole('button', { name: /^Wait/ })).toHaveCount(0)
  await steps.getByRole('button', { name: /^Send message/ }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('We are open 9 to 6.')
  await page.getByRole('button', { name: 'Add a step after Send message' }).click()
  await page
    .getByRole('dialog', { name: 'Add a step' })
    .getByRole('button', { name: /^End/ })
    .click()
  await expect(page.getByTestId(/^flow-node-/)).toHaveCount(3)
  // A "+" on the edge inserts between both ends.
  await page.getByRole('button', { name: 'Add a step between Keyword and Send message' }).click()
  await page
    .getByRole('dialog', { name: 'Add a step' })
    .getByRole('button', { name: /^Wait/ })
    .click()
  await expect(page.getByTestId('flow-summary')).toHaveText(
    'When a message is “hours”, wait 1 hour, then send “We are open 9 to 6.”.',
  )
  if ((await page.getByRole('tab', { name: 'Ready to publish', exact: true }).count()) === 0)
    await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  await page.getByRole('tab', { name: 'Ready to publish', exact: true }).click()
  await expect(page.getByText('Yes. Every step is set up and connected.')).toBeVisible()
})

test('a dry-run test highlights the path and changes nothing', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const owner = await signInAsNewOwner(page, 'flow-dry-run')
  const headers = ownerHeaders(owner)
  const tag = (
    await (
      await page.request.post(`${API}/tags`, { headers, data: { name: 'lead', color: 'PRIMARY' } })
    ).json()
  ).data
  const flow = (
    await (await page.request.post(`${API}/flows`, { headers, data: { name: 'Dry run' } })).json()
  ).data
  const draft = (
    await (await page.request.get(`${API}/flows/${flow.id}/draft`, { headers })).json()
  ).data
  const saved = await page.request.put(`${API}/flows/${flow.id}/draft`, {
    headers: { ...headers, 'If-Match': draft.etag },
    data: {
      graph: {
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.keyword',
            config: { keywords: ['price'], match: 'CONTAINS', caseSensitive: false },
          },
          { id: 'tag', type: 'action.add_tag', config: { tagIds: [tag.id] } },
          {
            id: 'send',
            type: 'action.send_message',
            config: { text: 'Hi {{contact.firstName}}!' },
          },
          {
            id: 'hook',
            type: 'action.webhook',
            config: { method: 'POST', url: 'https://example.com/hook', timeoutMs: 5000 },
          },
          { id: 'end', type: 'action.end', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'tag', sourceHandle: 'next' },
          { id: 'e2', source: 'tag', target: 'send', sourceHandle: 'next' },
          { id: 'e3', source: 'send', target: 'hook', sourceHandle: 'next' },
          { id: 'e4', source: 'hook', target: 'end', sourceHandle: 'next' },
        ],
        layout: {},
      },
    },
  })
  expect(saved.status()).toBe(200)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/automations/${flow.id}`)
  await page.getByRole('button', { name: 'Test flow', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Test this automation' })
  await drawer.getByLabel('Name').fill('Asha')
  await drawer.getByLabel('Incoming message').fill('what is the price?')
  await drawer.getByRole('button', { name: 'Run test' }).click()
  const result = drawer.getByRole('list', { name: 'Test steps' })
  await expect(result.getByRole('listitem')).toHaveCount(5)
  await expect(result).toContainText('Would add the tag lead.')
  await expect(result).toContainText('Would send: “Hi Asha!”')
  await expect(result).toContainText(
    'Would call POST https://example.com/hook (not called in a test).',
  )
  await expectNoViolations(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('.fw-edge-active')).toHaveCount(4)
  // Reduced motion: the path stays highlighted without the animated dash.
  const animation = () =>
    page
      .locator('.fw-edge-active .react-flow__edge-path')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)
  expect(await animation()).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await animation()).toBe('fw-edge-dash')

  // No side effects: no run, no tagged contact, no message, no made-up contact.
  await refreshCsrf(page, owner)
  const runs = await (
    await page.request.get(`${API}/flows/${flow.id}/executions`, { headers })
  ).json()
  expect(runs.data).toEqual([])
  const tags = (await (await page.request.get(`${API}/tags`, { headers })).json()).data
  expect(tags.find((t: { id: string }) => t.id === tag.id).contactCount).toBe(0)
  const contacts = await (
    await page.request.post(`${API}/contacts/search`, {
      headers: ownerHeaders(owner),
      data: { limit: 10 },
    })
  ).json()
  // No contact means no conversation or outbound message could exist either.
  expect(contacts.data).toEqual([])
})

test('keyboard only: gallery tabs and cards, then the outline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInAsNewOwner(page, 'flow-keys')
  await page.goto('/automations/new')
  await page.getByRole('tab', { name: 'Popular' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Welcome & replies' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const tabTo = async (testId: string) => {
    for (let i = 0; i < 8; i++) {
      if (await page.getByTestId(testId).evaluate((el) => el === document.activeElement)) return
      await page.keyboard.press('Tab')
    }
    throw new Error(`${testId} never received focus`)
  }
  await tabTo('template-scratch')
  await tabTo('template-out-of-hours')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Out-of-hours reply', level: 1 })).toBeVisible()
  await page.getByRole('tab', { name: 'Canvas' }).focus()
  await page.keyboard.press('ArrowRight')
  const steps = page.getByRole('list', { name: 'Flow steps' }).getByRole('listitem')
  await expect(steps).toHaveCount(5)
  await expect(steps.nth(1)).toContainText('If contact has tag')
  await expectNoViolations(page)
})

test('gallery and editor pass axe on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsNewOwner(page, 'flow-phone')
  await page.goto('/automations/new')
  await expect(page.getByTestId('template-scratch').first()).toBeVisible()
  await expectNoViolations(page)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.getByTestId('template-keyword-reply').first().click()
  await expect(page.getByRole('heading', { name: 'Keyword reply', level: 1 })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Setup checklist · Ready to publish' }).click()
  await expect(page.getByRole('region', { name: 'Set up your automation' })).toBeVisible()
  await expectNoViolations(page)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
