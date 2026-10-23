import { type CookieOptions, type Response } from 'express'

/** docs/SECURITY.md → Sessions. */
export const ACCESS_COOKIE = 'fw_at'
export const REFRESH_COOKIE = 'fw_rt'
export const CSRF_COOKIE = 'fw_csrf'
export const ACCESS_TTL_SECONDS = 15 * 60
/** Absolute session limit from sign-in (customer app and /platform). Activity never extends it. */
export const SESSION_ABSOLUTE_SECONDS = 12 * 3600
/** Idle limit, tracked server-side: only requests that declare user activity reset it. */
export const SESSION_IDLE_SECONDS = 3 * 3600
export const REFRESH_TTL_SECONDS = SESSION_ABSOLUTE_SECONDS
/** Sent by the web app when the user interacted since its last request (keyboard, pointer). */
export const ACTIVITY_HEADER = 'x-fenwira-active'
export const REFRESH_PATH = '/api/v1/auth'

export type CookieSettings = { secure: boolean; domain?: string }

const base = (s: CookieSettings): CookieOptions => ({
  httpOnly: true,
  secure: s.secure,
  ...(s.domain ? { domain: s.domain } : {}),
})

export function setSessionCookies(
  res: Response,
  s: CookieSettings,
  tokens: {
    accessToken: string
    refreshToken: string
    csrfToken: string
    /** Absolute end of the server session: cookies never outlive it. */
    expiresAt?: Date
    accessExpiresAt?: Date
  },
): void {
  const until = (at: Date | undefined, fallbackSeconds: number) =>
    at ? { expires: at } : { maxAge: fallbackSeconds * 1000 }
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(s),
    sameSite: 'lax',
    path: '/',
    ...until(tokens.accessExpiresAt, ACCESS_TTL_SECONDS),
  })
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(s),
    sameSite: 'strict',
    path: REFRESH_PATH,
    ...until(tokens.expiresAt, REFRESH_TTL_SECONDS),
  })
  // HttpOnly: the client receives the CSRF token in response bodies and echoes it in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base(s),
    sameSite: 'lax',
    path: '/',
    ...until(tokens.expiresAt, REFRESH_TTL_SECONDS),
  })
}

export function clearSessionCookies(res: Response, s: CookieSettings): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(s), sameSite: 'lax', path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...base(s), sameSite: 'strict', path: REFRESH_PATH })
  res.clearCookie(CSRF_COOKIE, { ...base(s), sameSite: 'lax', path: '/' })
}
