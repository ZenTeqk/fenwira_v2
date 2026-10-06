import { expect, test } from '@playwright/test'
import {
  linkFromEmail,
  PASSWORD,
  resetRateLimits,
  signInAsNewOwner,
  totp,
  uniqueEmail,
} from './support'

// Phase 3 acceptance: every flow in the browser, with emails read from Mailpit.
test.beforeEach(() => resetRateLimits())

test('register → verify email → create workspace → dashboard', async ({ page }) => {
  const email = uniqueEmail('ui-register')
  const since = Date.now()
  await page.goto('/register')
  await page.getByLabel('Your name').fill('Priya Sharma')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/verify-email$/)
  await expect(page.getByText(email)).toBeVisible()

  await page.goto(await linkFromEmail(email, '/verify-email', since))
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Workspace name').fill('Urban Leaf Home')
  await page.getByRole('button', { name: 'Create workspace' }).click()

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Current workspace: Urban Leaf Home/ }),
  ).toBeVisible()
})

test('sign out, sign back in, and wrong passwords get one generic error', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-login')
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill('not-the-right-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()

  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('signed-out visitors are sent to sign in and returned afterwards', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-next')
  await page.context().clearCookies()
  await page.goto('/settings/team')
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fteam/)
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/settings\/team$/)
})

test('forgot password → emailed link → new password works, old one does not', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-reset')
  const visitor = await (await browser.newContext()).newPage()
  const since = Date.now()
  await visitor.goto('/forgot-password')
  await visitor.getByLabel('Email').fill(owner.email)
  await visitor.getByRole('button', { name: 'Send reset link' }).click()
  await expect(visitor.getByText('Check your inbox')).toBeVisible()

  await visitor.goto(await linkFromEmail(owner.email, '/reset-password', since))
  await visitor.getByLabel('New password').fill('a-brand-new-passphrase')
  await visitor.getByRole('button', { name: 'Update password' }).click()
  await expect(visitor.getByRole('heading', { name: 'Password updated' })).toBeVisible()

  await visitor.getByRole('link', { name: 'Sign in' }).click()
  await visitor.getByLabel('Email').fill(owner.email)
  await visitor.getByLabel('Password').fill(PASSWORD)
  await visitor.getByRole('button', { name: 'Sign in' }).click()
  await expect(visitor.getByText('Email or password is incorrect.')).toBeVisible()
  await visitor.getByLabel('Password').fill('a-brand-new-passphrase')
  await visitor.getByRole('button', { name: 'Sign in' }).click()
  await expect(visitor).toHaveURL(/\/dashboard$/)

  // The reset signed out every existing session, including the original browser.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('two-factor: enrol with an authenticator, then sign in with a code', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-2fa')
  await page.goto('/settings/security')
  await page.getByRole('button', { name: 'Set up two-factor' }).click()
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible()
  const secret = (await page.locator('code').first().textContent())!.trim()
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await expect(page.getByText('Save your backup codes now')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(
    10,
  )

  await page.getByRole('button', { name: /Workspace account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/two-factor/)
  await page.getByLabel('Authentication code').fill(totp(secret, 1))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('sessions: the security page lists this device and can sign out others', async ({
  page,
  browser,
}) => {
  const owner = await signInAsNewOwner(page, 'ui-sessions')
  const other = await (await browser.newContext()).newPage()
  await other.goto('/login')
  await other.getByLabel('Email').fill(owner.email)
  await other.getByLabel('Password').fill(PASSWORD)
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other).toHaveURL(/\/dashboard$/)

  await page.goto('/settings/security')
  const sessions = page.getByRole('list', { name: 'Active sessions' }).getByRole('listitem')
  await expect(sessions).toHaveCount(2)
  await expect(page.getByText('This device')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out other sessions' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out others' }).click()
  await expect(sessions).toHaveCount(1)

  await other.reload()
  await expect(other).toHaveURL(/\/login/)
})
