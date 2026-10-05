import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { API, PASSWORD, linkFromEmail, resetRateLimits, totp, uniqueEmail } from './support'

/** Verified global identity with MFA, never a customer membership. Revoke in caller finally. */
export async function provisionOperator(page: Page, label: string) {
  resetRateLimits()
  const email = uniqueEmail(label),
    since = Date.now()
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: 'Platform browser fixture', email, password: PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const csrf = (await registration.json()).data.csrfToken as string
  const token = new URL(await linkFromEmail(email, '/verify-email', since)).searchParams.get(
    'token',
  )
  expect(
    (
      await page.request.post(`${API}/auth/email/verify`, {
        data: { token },
        headers: { 'X-CSRF-Token': csrf },
      })
    ).status(),
  ).toBe(204)
  const setup = await page.request.post(`${API}/me/2fa/setup`, {
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(setup.status()).toBe(200)
  const secret = (await setup.json()).data.secret as string
  expect(
    (
      await page.request.post(`${API}/me/2fa/enable`, {
        data: { code: totp(secret) },
        headers: { 'X-CSRF-Token': csrf },
      })
    ).status(),
  ).toBe(200)
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).data as {
    user: { id: string }
    memberships: unknown[]
  }
  expect(me.memberships).toHaveLength(0)
  const provision = (revoke = false) =>
    execFileSync(
      'docker',
      [
        'compose',
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint',
        'node',
        'fenwira-migrate',
        'packages/database/dist/cli/platform-operator.js',
        '--user',
        me.user.id,
        '--actor',
        'platform-browser-test',
        '--reason',
        'Isolated local browser fixture',
        ...(revoke ? ['--revoke'] : []),
      ],
      { cwd: resolve(__dirname, '../../..'), stdio: 'pipe', timeout: 30000 },
    )
  try {
    provision()
  } catch (error) {
    provision(true)
    throw error
  }
  return { email, secret, userId: me.user.id, revoke: () => provision(true) }
}
