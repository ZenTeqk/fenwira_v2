import { GraphError } from './errors'
import { type GraphConfig, graphUrl } from './graph'

export type GraphClientOptions = GraphConfig & { timeoutMs?: number; fetch?: typeof fetch }

type RequestOptions = { query?: Record<string, string>; json?: unknown; form?: FormData }

/**
 * Shared Graph transport: Bearer auth, timeout, and GraphError classification. Tokens travel only
 * in the Authorization header (or, for the code exchange, the query as Meta requires) and never
 * appear in error messages.
 */
export class GraphHttp {
  readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(private readonly options: GraphClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.doFetch = options.fetch ?? fetch
  }

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string | undefined,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = graphUrl(this.options, path, opts.query)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    const res = await this.fetchRaw(url, {
      method,
      headers,
      body: opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)),
    })
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) throw errorFrom(res.status, body)
    return body as T
  }

  /** Authenticated GET of an absolute URL (media downloads). Returns the bytes. */
  async download(url: string, token: string): Promise<{ bytes: Buffer; mimeType?: string }> {
    const res = await this.fetchRaw(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw errorFrom(res.status, await res.json().catch(() => null))
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') ?? undefined,
    }
  }

  private async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new GraphError(
        timedOut ? `Meta did not respond within ${this.timeoutMs} ms` : 'Could not reach Meta',
        undefined,
        undefined,
      )
    }
  }
}

function errorFrom(status: number, body: unknown): GraphError {
  const e = (
    body as {
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
    } | null
  )?.error
  return new GraphError(
    e?.message ?? `Meta returned HTTP ${status}`,
    status,
    e?.code,
    e?.error_subcode,
    e?.fbtrace_id,
  )
}
