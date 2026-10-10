import { expect, test } from '@playwright/test'
import { linkFromEmail, PASSWORD, resetRateLimits, signInAsNewOwner, uniqueEmail } from './support'

test.beforeEach(() => resetRateLimits())

test('invite a teammate from the Team page; they accept as a new account', async ({
  page,
  browser,
}) => {
  await signInAsNewOwner(page, 'ui-inviter', 'Acme Foods')
  await page.goto('/settings/team')
  await page.getByRole('button', { name: 'Invite teammate' }).click()
  const invitee = uniqueEmail('ui-invitee')
  const since = Date.now()
  const dialog = page.getByRole('dialog', { name: 'Invite a teammate' })
  await dialog.getByLabel('Email').fill(invitee)
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(
    page.getByRole('table', { name: 'Pending invitations' }).getByText(invitee),
  ).toBeVisible()

  const guest = await (await browser.newContext()).newPage()
  await guest.goto(await linkFromEmail(invitee, '/invitations/', since))
  await expect(guest.getByRole('heading', { name: 'Join Acme Foods' })).toBeVisible()
  await guest.getByLabel('Your name').fill('New Agent')
  await guest.getByLabel('Choose a password').fill(PASSWORD)
  await guest.getByRole('button', { name: 'Create account and join' }).click()
  await expect(guest).toHaveURL(/\/dashboard$/)
  await expect(guest.getByRole('button', { name: /Current workspace: Acme Foods/ })).toBeVisible()

  // Agents don't see admin-only settings.
  await guest.goto('/settings/team')
  await expect(guest.getByRole('button', { name: 'Invite teammate' })).toHaveCount(0)
  const settingsTabs = guest.getByRole('navigation', { name: 'Settings pages' })
  await expect(settingsTabs.getByRole('link', { name: 'Team' })).toBeVisible()
  await expect(settingsTabs.getByRole('link', { name: 'Audit logs' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('table', { name: 'Team members' }).getByText(invitee)).toBeVisible()
})

test('switching workspace changes all data on screen (no stale cache)', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-switch', 'Alpha Traders')
  // Second workspace for the same user, through the UI.
  await page.goto('/onboarding')
  await page.getByLabel('Workspace name').fill('Beta Stores')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('button', { name: /Current workspace: Beta Stores/ })).toBeVisible()

  await page.goto('/settings/workspace')
  await expect(page.getByLabel('Workspace name')).toHaveValue('Beta Stores')

  await page.getByRole('button', { name: /Current workspace: Beta Stores/ }).click()
  await page.getByRole('menuitem', { name: 'Alpha Traders' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('button', { name: /Current workspace: Alpha Traders/ })).toBeVisible()

  await page.goto('/settings/workspace')
  await expect(page.getByLabel('Workspace name')).toHaveValue('Alpha Traders')
  await page.goto('/settings/audit-logs')
  const log = page.getByRole('table', { name: 'Audit log' })
  await expect(log.getByText('Created the workspace')).toHaveCount(1)

  // The choice survives a reload.
  await page.reload()
  await expect(page.getByRole('button', { name: /Current workspace: Alpha Traders/ })).toBeVisible()
})

test('the roles page shows the read-only permission matrix', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-roles')
  await page.goto('/settings/roles')
  const matrix = page.getByRole('table', { name: 'Role permissions' })
  await expect(matrix.getByRole('columnheader', { name: 'Viewer' })).toBeVisible()
  await expect(matrix.getByText('team.manage')).toBeVisible()
})
