import { type ErrorCode, type FieldError } from '@fenwira/contracts'

/**
 * Browser API client (docs/API_SPEC.md). Sends cookies, the CSRF token (held in memory — the
 * cookie is HttpOnly) and the active tenant; on an expired session it refreshes once and retries.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: Record<string, unknown>,
    readonly fieldErrors?: FieldError[],
    readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field-level message for a form input, if the server sent one. */
  field(path: string): string | undefined {
    return this.fieldErrors?.find((f) => f.path === path)?.message
  }
}

let csrfToken = ''
let activeTenantId: string | undefined
let refreshing: Promise<boolean> | null = null
let fetchingCsrf: Promise<void> | null = null

export const setCsrfToken = (token: string | undefined) => {
  if (token) csrfToken = token
}
export const setActiveTenantId = (tenantId: string | undefined) => {
  activeTenantId = tenantId
}
export const getActiveTenantId = () => activeTenantId

type Options = {
  body?: unknown
  tenant?: boolean
  signal?: AbortSignal
  /** Extra request headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>
}

async function send(method: string, path: string, opts: Options): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  if (opts.tenant !== false && activeTenantId) headers['X-Tenant-Id'] = activeTenantId
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  })
}

/** Single-flight refresh: concurrent 401s share one rotation (a second one would look like reuse). */
async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', { tenant: false })
      if (!res.ok) return false
      setCsrfToken(((await res.json()) as { data: { csrfToken: string } }).data.csrfToken)
      return true
    } catch {
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

/**
 * The CSRF token lives in memory, so after a full page load it is empty until /auth/me runs.
 * Mutations fetch it on demand (single flight); signed-out callers simply get no token.
 */
async function ensureCsrf(force = false): Promise<void> {
  if (csrfToken && !force) return
  fetchingCsrf ??= (async () => {
    try {
      const res = await send('GET', '/auth/me', { tenant: false })
      if (res.ok)
        setCsrfToken(((await res.json()) as { data: { csrfToken: string } }).data.csrfToken)
    } catch {
      // Network problems surface on the real request.
    } finally {
      setTimeout(() => (fetchingCsrf = null), 0)
    }
  })()
  return fetchingCsrf
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: Options = {},
): Promise<T> {
  let res: Response
  try {
    if (method !== 'GET') await ensureCsrf()
    res = await send(method, path, opts)
    if (res.status === 403 && method !== 'GET') {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: string } } | null
      if (body?.error?.code === 'CSRF_FAILED') {
        await ensureCsrf(true)
        res = await send(method, path, opts)
      }
    }
    if (
      res.status === 401 &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/login')
    ) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: string } } | null
      if (body?.error?.code === 'SESSION_EXPIRED' && (await refreshSession()))
        res = await send(method, path, opts)
    }
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Could not reach Fenwira. Check your connection and try again.',
    )
  }
  if (res.status === 204) return undefined as T
  const json = (await res.json().catch(() => null)) as {
    data?: unknown
    error?: {
      code: ErrorCode
      message: string
      details?: Record<string, unknown>
      fieldErrors?: FieldError[]
      correlationId?: string
    }
  } | null
  if (!res.ok) {
    const e = json?.error
    throw new ApiError(
      res.status,
      e?.code ?? 'INTERNAL',
      e?.message ?? 'Something went wrong.',
      e?.details,
      e?.fieldErrors,
      e?.correlationId,
    )
  }
  return json as T
}

export const get = <T>(path: string, opts?: Options) => api<T>('GET', path, opts)
export const post = <T>(path: string, body?: unknown, opts?: Options) =>
  api<T>('POST', path, { ...opts, body: body ?? {} })
export const patch = <T>(path: string, body: unknown, opts?: Options) =>
  api<T>('PATCH', path, { ...opts, body })
export const del = <T>(path: string, opts?: Options) => api<T>('DELETE', path, opts)
