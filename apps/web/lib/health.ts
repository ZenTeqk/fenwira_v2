import { type HealthResponse, healthResponseSchema } from '@fenwira/contracts'

export type ApiHealthView =
  | {
      reachable: true
      overall: 'ok' | 'error'
      version: string
      checks: Array<{ name: string; up: boolean; detail: string }>
    }
  | { reachable: false; reason: string }

/** Pure mapping from the API's /health payload to what the status page renders. */
export function toHealthView(payload: unknown): ApiHealthView {
  const parsed = healthResponseSchema.safeParse(payload)
  if (!parsed.success) return { reachable: false, reason: 'Unexpected response from the API.' }
  const report: HealthResponse = parsed.data
  return {
    reachable: true,
    overall: report.status,
    version: report.version,
    checks: Object.entries(report.checks).map(([name, result]) => ({
      name,
      up: result.status === 'up',
      detail: result.status === 'up' ? `${result.latencyMs ?? 0} ms` : (result.error ?? 'down'),
    })),
  }
}

export async function fetchApiHealth(
  baseUrl: string,
  path = '/health',
  timeoutMs = 2000,
): Promise<ApiHealthView> {
  try {
    const res = await fetch(new URL(path, baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return toHealthView(await res.json())
  } catch (err) {
    return { reachable: false, reason: err instanceof Error ? err.message : 'API unreachable' }
  }
}
