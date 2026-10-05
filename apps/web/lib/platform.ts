import { platformMeSchema, type PlatformMe } from '@fenwira/contracts'
import { ApiError } from './api/client'
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'
let csrf = ''
export let platformLastRequest = Date.now()
export function clearPlatformSession() {
  csrf = ''
}
/** Dedicated request boundary: no tenant header, tenant refresh, API key or persisted credential. */
export async function platformRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/platform${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; correlationId?: string }
    }
    if (res.status === 401 || (res.status === 403 && payload.error?.code === 'FORBIDDEN')) {
      clearPlatformSession()
      window.dispatchEvent(new Event('platform-expired'))
    }
    throw new ApiError(
      res.status,
      (payload.error?.code ?? 'NETWORK') as never,
      payload.error?.message ?? 'Platform request failed.',
      undefined,
      undefined,
      payload.error?.correlationId,
    )
  }
  platformLastRequest = Date.now()
  if (res.status === 204) return undefined as T
  const payload = (await res.json()) as { data: T }
  return payload.data
}
export async function platformMe(): Promise<PlatformMe> {
  const me = platformMeSchema.parse(await platformRequest('/auth/me'))
  csrf = me.csrfToken
  return me
}
export function platformCsrf(value: string) {
  csrf = value
}
export function platformMoney(minor: string | null, currency = 'INR') {
  if (minor === null) return 'Unknown'
  const n = BigInt(minor),
    abs = n < 0n ? -n : n
  return `${currency} ${n < 0n ? '-' : ''}${(abs / 100n).toLocaleString('en-IN')}.${(abs % 100n).toString().padStart(2, '0')}`
}
