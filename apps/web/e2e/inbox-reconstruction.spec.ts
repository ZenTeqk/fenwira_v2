import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { customerWritesIn, signInAsNewOwner } from './support'

// The previous layout's geometry test was replaced by e2e/inbox-redesign.spec.ts.

test('Inbox distinguishes empty, failed and searched states and supports keyboard selection', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const owner = await signInAsNewOwner(page, 'ui-inbox-states')
  await page.goto('/inbox')
  const conversations = page.getByRole('region', { name: 'Conversations', exact: true })
  await expect(conversations.getByText('Nothing here', { exact: true })).toBeVisible()
  const failedList = '**/api/v1/conversations?**'
  await page.route(failedList, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'UNAVAILABLE',
          message: 'Temporarily unavailable',
          correlationId: 'inbox-list-test',
        },
      }),
    }),
  )
  await page.reload()
  await expect(conversations.getByRole('alert').getByText('Something went wrong')).toBeVisible()
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.unroute(failedList)
  await conversations.getByRole('button', { name: 'Try again' }).click()
  await expect(conversations.getByText('Nothing here', { exact: true })).toBeVisible()
  const customer = await customerWritesIn(page, owner, 'Please confirm the delivery date.')
  await page.goto('/inbox')
  const list = page.getByRole('list', { name: 'Conversation list' })
  await expect(list.getByText(customer)).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Search conversations' })
  await search.fill('no-such-inbox-record-849726')
  await expect(conversations.getByText('No matches', { exact: true })).toBeVisible()
  await search.fill('')
  const row = list.getByRole('button').filter({ hasText: customer })
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('log', { name: 'Messages' }).getByText('Please confirm the delivery date.'),
  ).toBeVisible()
})
