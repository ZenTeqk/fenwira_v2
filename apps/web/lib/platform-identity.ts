import { platformReauthSchema, type PlatformMe } from '@fenwira/contracts'
import { ApiError } from './api/client'
import { platformMe, platformRequest } from './platform'

/** The server's answer when the short identity check (password + fresh code) has lapsed. */
export const needsIdentity = (err: unknown) =>
  err instanceof ApiError && err.code === 'TOTP_REQUIRED'

/**
 * Runs a consequential operator action. When the identity check has lapsed it asks for
 * verification once and, if that succeeds, retries the action exactly once.
 */
export async function withIdentity<T>(
  action: () => Promise<T>,
  verify: () => Promise<boolean>,
): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (!needsIdentity(err) || !(await verify())) throw err
    return action()
  }
}

/** Sends password and code once; nothing is kept. Returns the refreshed session. */
export async function verifyIdentity(password: string, code: string): Promise<PlatformMe> {
  await platformRequest('/auth/reauth', platformReauthSchema.parse({ password, code }))
  return platformMe()
}

export function verificationFailure(err: unknown) {
  if (err instanceof ApiError && err.code === 'RATE_LIMITED')
    return 'Too many attempts. Wait five minutes, then try again.'
  if (err instanceof ApiError && err.status === 401)
    return 'The password or authenticator code is not correct. Use the code currently shown in your app.'
  return 'Enter your operator password and the 6-digit code from your authenticator app.'
}

/** Milliseconds left in the identity-check window (0 when lapsed or unknown). */
export const identityLeft = (freshUntil: string | undefined, now: number) =>
  freshUntil ? Math.max(0, new Date(freshUntil).getTime() - now) : 0
