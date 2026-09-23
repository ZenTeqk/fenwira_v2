import { serverEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Web health (docs/OBSERVABILITY.md): the process is up and the API liveness endpoint is reachable. */
export async function GET(): Promise<Response> {
  const api = await fetchApiLive()
  const body = {
    status: api ? 'ok' : 'error',
    service: 'web',
    checks: { api: { status: api ? 'up' : 'down' } },
  }
  return Response.json(body, { status: api ? 200 : 503 })
}

async function fetchApiLive(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/health/live', serverEnv.API_INTERNAL_URL), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}
