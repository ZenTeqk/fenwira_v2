import { type APIRequestContext, expect, type Page, type BrowserContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'

export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
export const PASSWORD = 'correct-horse-battery-fenwira'

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@fenwira.test`

/**
 * Test-only: clear the auth rate-limit counters in the local stack's Redis. Every e2e account is
 * created from the same IP, which would otherwise hit the real per-IP limits (5 sign-ups an hour).
 */
export function resetRateLimits(): void {
  const root = resolve(__dirname, '../../..')
  const isolated = process.env.E2E_REDIS_CONTAINER
  if (isolated && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(isolated))
    throw new Error('Invalid isolated E2E Redis container name')
  const redisDb = process.env.E2E_REDIS_DB ?? '0'
  if (!/^(?:[0-9]|1[0-5])$/.test(redisDb)) throw new Error('Invalid E2E Redis database')
  const command = isolated
    ? ['exec', isolated, 'redis-cli', '-n', redisDb]
    : ['compose', 'exec', '-T', 'fenwira-redis', 'redis-cli', '-n', redisDb]
  const keys = execFileSync('docker', [...command, '--scan', '--pattern', 'rl:*'], { cwd: root })
    .toString()
    .split('\n')
    .filter(Boolean)
  if (keys.length) execFileSync('docker', [...command, 'DEL', ...keys], { cwd: root })
}

/** Newest link containing `pathPart` in an email to `to`, sent at or after `since` (epoch ms). */
export async function linkFromEmail(
  to: string,
  pathPart: string,
  since = 0,
  timeoutMs = 20_000,
): Promise<string> {
  const after = new Date(since).toISOString()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const body = (await res.json()) as { messages?: Array<{ ID: string; Created: string }> }
    const newest = body.messages
      ?.filter((m) => m.Created >= after)
      .sort((a, b) => b.Created.localeCompare(a.Created))[0]
    if (newest) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as {
        Text: string
      }
      const link = msg.Text.split(/\s+/).find((w) => w.startsWith('http') && w.includes(pathPart))
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No email to ${to} containing ${pathPart}`)
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so tests can act like an authenticator app.
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totp(secret: string, stepOffset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + stepOffset
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

export type Owner = { email: string; tenantId: string; workspaceName: string; csrf: string }

/**
 * Creates a verified owner with a workspace through the API, using the page's cookie jar so the
 * browser is signed in afterwards (API and web share the `localhost` cookie scope).
 */
export async function signInAsNewOwner(
  page: Page,
  label: string,
  workspaceName = `${label} Workspace`,
): Promise<Owner> {
  resetRateLimits()
  const request: APIRequestContext = page.request
  const email = uniqueEmail(label)
  const since = Date.now()
  const reg = await request.post(`${API}/auth/register`, {
    data: { name: `${label} Owner`, email, password: PASSWORD },
  })
  expect(reg.status(), await reg.text()).toBe(201)
  let csrf = ((await reg.json()) as { data: { csrfToken: string } }).data.csrfToken
  const token = new URL(await linkFromEmail(email, '/verify-email', since)).searchParams.get(
    'token',
  )
  const verified = await request.post(`${API}/auth/email/verify`, {
    data: { token },
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(verified.status()).toBe(204)
  const created = await request.post(`${API}/tenants`, {
    data: { name: workspaceName },
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(created.status(), await created.text()).toBe(201)
  const tenantId = ((await created.json()) as { data: { id: string } }).data.id
  const me = await request.get(`${API}/auth/me`)
  csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken
  return { email, tenantId, workspaceName, csrf }
}

export const MOCK = process.env.E2E_META_MOCK_URL ?? 'http://127.0.0.1:4200'
export const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
export const ownerHeaders = (o: Owner) => ({ 'X-CSRF-Token': o.csrf, 'X-Tenant-Id': o.tenantId })

/**
 * Loading the app rotates the session's CSRF token, so API writes made after a page visit need the
 * current one. Updates `owner.csrf` in place (ownerHeaders reads it).
 */
export async function refreshCsrf(page: Page, owner: Owner): Promise<void> {
  const me = await page.request.get(`${API}/auth/me`)
  owner.csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken
}

/** Connects a fresh simulated number and has a customer write in. Returns the customer's name. */
export async function customerWritesIn(page: Page, owner: Owner, text: string) {
  await refreshCsrf(page, owner)
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await fetch(`${MOCK}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId, phones: [{ id: phoneNumberId }] }),
  })
  const connected = await page.request.post(`${API}/whatsapp/connections/dev`, {
    data: { wabaId, phoneNumberId, accessToken: `mock-dev:${wabaId}` },
    headers: ownerHeaders(owner),
  })
  expect(connected.status(), await connected.text()).toBe(201)
  const name = `Customer ${metaId().slice(-4)}`
  const res = await fetch(`${MOCK}/__mock/inbound`, {
    method: 'POST',
    body: JSON.stringify({
      phoneNumberId,
      from: `9195${String(Math.random()).slice(2, 10)}`,
      name,
      text,
    }),
  })
  expect(res.ok).toBe(true)
  return name
}

/**
 * REVIEW_THEME=dark runs every page of a context on the dark tokens: `data-theme="dark"` on
 * <html> before any app script, kept if anything re-renders it. Portaled overlays live under
 * <html>, so they inherit it. There is no theme switcher; this is a review harness only.
 */
export const reviewTheme = process.env.REVIEW_THEME === 'dark' ? 'dark' : null
export async function applyReviewTheme(context: BrowserContext): Promise<void> {
  if (!reviewTheme) return
  await context.addInitScript(() => {
    // Init scripts run before <html> exists, so apply it as soon as it appears and keep it.
    const keep = () => {
      const root = document.documentElement
      if (root && root.getAttribute('data-theme') !== 'dark')
        root.setAttribute('data-theme', 'dark')
    }
    keep()
    new MutationObserver(keep).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  })
}

/**
 * E2E_WEB_UPSTREAM serves the web app from another local server (e.g. a production `next start`
 * on :3001) while pages keep the localhost:3000 origin the local API accepts. API calls are relayed
 * the same way (and local object storage on :9000), so a relayed page never fetches loopback itself. Redirects and failed requests
 * behave as in a browser. Review harness only.
 */
export async function applyWebUpstream(context: BrowserContext): Promise<void> {
  const upstream = process.env.E2E_WEB_UPSTREAM
  if (!upstream) return
  await context.route(/^http:\/\/localhost:(3000|4000|9000)\//, async (route) => {
    const url = route.request().url().replace('http://localhost:3000', upstream)
    const response = await route.fetch({ url, maxRedirects: 0 }).catch(() => null)
    if (!response) return route.abort('failed')
    // A fulfilled redirect's follow-up request isn't intercepted, so redirect from the page
    // instead; the browser then requests the target through this relay (same final URL).
    const location = response.headers()['location']
    if (response.status() >= 300 && response.status() < 400 && location)
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>location.replace(${JSON.stringify(location.replace(upstream, 'http://localhost:3000'))})</script>`,
      })
    // The page may already have navigated away; a late answer is then irrelevant.
    await route.fulfill({ response }).catch(() => undefined)
  })
}
