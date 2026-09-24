import { type CookieOptions, type Response } from 'express'

/** docs/SECURITY.md → Sessions. */
export const ACCESS_COOKIE = 'fw_at'
export const REFRESH_COOKIE = 'fw_rt'
export const CSRF_COOKIE = 'fw_csrf'
export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600
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
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(s),
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS * 1000,
  })
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(s),
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  })
  // HttpOnly: the client receives the CSRF token in response bodies and echoes it in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base(s),
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS * 1000,
  })
}

export function clearSessionCookies(res: Response, s: CookieSettings): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(s), sameSite: 'lax', path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...base(s), sameSite: 'strict', path: REFRESH_PATH })
  res.clearCookie(CSRF_COOKIE, { ...base(s), sameSite: 'lax', path: '/' })
}
