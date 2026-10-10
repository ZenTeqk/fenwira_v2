import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent, request } from 'undici'

/**
 * SSRF-safe outbound HTTP for the automation webhook action (docs/SECURITY.md → Outbound webhooks,
 * decision P10-D4). The hostname is resolved once, every address must be public, and the TCP
 * connection is pinned to the validated address (no second lookup, no DNS rebinding). Redirects
 * are followed manually and every hop is validated again.
 */

export type SafeFetchErrorCode =
  | 'WEBHOOK_URL_INVALID'
  | 'WEBHOOK_BLOCKED_DESTINATION'
  | 'WEBHOOK_TIMEOUT'
  | 'WEBHOOK_RESPONSE_TOO_LARGE'
  | 'WEBHOOK_TOO_MANY_REDIRECTS'
  | 'WEBHOOK_NETWORK_ERROR'

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export type SafeFetchPolicy = {
  /** Host names allowed over http: and to private addresses (development only; refused in production). */
  devHosts?: readonly string[]
  connectTimeoutMs?: number
  /** Hard ceiling for the whole call, redirects included. */
  maxTotalMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  /** Test seam: resolves a host name to all of its addresses. */
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>
}

export type SafeRequest = {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type SafeResponse = {
  status: number
  headers: Record<string, string>
  body: string
  durationMs: number
  finalUrl: string
  redirects: number
}

export const SAFE_FETCH_DEFAULTS = {
  connectTimeoutMs: 3000,
  maxTotalMs: 10_000,
  maxResponseBytes: 64 * 1024,
  maxRedirects: 3,
} as const

// ------------------------------------------------------------------------------ address rules

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network, unspecified
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (embeds IPv4)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID, …)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, prefix, 'ipv6')

const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.azure.com',
  'instance-data',
  'instance-data.ec2.internal',
])

/** An IPv4-mapped/compatible IPv6 address (::ffff:a.b.c.d or ::ffff:0a0b:0c0d) → its IPv4. */
function embeddedIpv4(address: string): string | null {
  const m = /^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (m) return m[1]!
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!hex) return null
  const hi = parseInt(hex[1]!, 16)
  const lo = parseInt(hex[2]!, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** True when the address may be contacted (public unicast). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIpv4(address.toLowerCase())
    if (v4) return isPublicAddress(v4)
    // Any other ::/96 form (IPv4-compatible) is deprecated and never public.
    if (/^::[0-9a-f.:]*$/i.test(address) && address !== '::') return false
    return !blocked.check(address, 'ipv6')
  }
  return false
}

/** Host names that never leave the platform network, whatever they resolve to. */
export function isInternalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (isIP(h)) return false
  return (
    !h.includes('.') ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.localdomain') ||
    h.endsWith('.home.arpa') ||
    METADATA_HOSTS.has(h)
  )
}

type Target = { url: URL; host: string; address: string; family: 4 | 6 }

/** Parses and fully validates one hop. Throws SafeFetchError; never connects. */
export async function validateDestination(
  raw: string,
  policy: SafeFetchPolicy = {},
): Promise<Target> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError('WEBHOOK_URL_INVALID', 'The webhook URL is not a valid URL.')
  }
  if (url.username || url.password)
    throw new SafeFetchError('WEBHOOK_URL_INVALID', 'Credentials in the URL are not allowed.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const dev = (policy.devHosts ?? []).map((h) => h.toLowerCase()).includes(host)
  if (url.protocol !== 'https:' && !(dev && url.protocol === 'http:'))
    throw new SafeFetchError('WEBHOOK_URL_INVALID', 'Webhook URLs must use https.')
  if (!dev && isInternalHostname(host))
    throw new SafeFetchError(
      'WEBHOOK_BLOCKED_DESTINATION',
      'The webhook host is an internal name and is not allowed.',
    )
  let addresses: Array<{ address: string; family: number }>
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }]
  else {
    try {
      addresses = await (policy.resolve ?? defaultResolve)(host)
    } catch {
      throw new SafeFetchError('WEBHOOK_NETWORK_ERROR', `Could not resolve ${host}.`)
    }
  }
  if (!addresses.length)
    throw new SafeFetchError('WEBHOOK_NETWORK_ERROR', `Could not resolve ${host}.`)
  // Every record must be public: a mixed answer is how rebinding attacks start.
  if (!dev && addresses.some((a) => !isPublicAddress(a.address)))
    throw new SafeFetchError(
      'WEBHOOK_BLOCKED_DESTINATION',
      'The webhook host resolves to a private or reserved address.',
    )
  const first = addresses[0]!
  return { url, host, address: first.address, family: first.family === 6 ? 6 : 4 }
}

const defaultResolve = (host: string) => dnsLookup(host, { all: true, verbatim: true })

/** A lookup that always answers with the validated address (the connection is pinned). */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }])
    else cb(null, address, family)
  }) as unknown as LookupFunction
}

const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])

// ------------------------------------------------------------------------------ request

export async function safeFetch(
  req: SafeRequest,
  policy: SafeFetchPolicy = {},
): Promise<SafeResponse> {
  const connectTimeout = policy.connectTimeoutMs ?? SAFE_FETCH_DEFAULTS.connectTimeoutMs
  const ceiling = policy.maxTotalMs ?? SAFE_FETCH_DEFAULTS.maxTotalMs
  const total = Math.min(req.timeoutMs ?? ceiling, ceiling)
  const maxBytes = policy.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes
  const maxRedirects = policy.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects
  const started = Date.now()
  const signal = AbortSignal.timeout(total)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {}))
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v

  let method = req.method
  let body = req.method === 'POST' || req.method === 'PUT' ? (req.body ?? '') : undefined
  let current = req.url
  for (let hop = 0; ; hop++) {
    const target = await validateDestination(current, policy)
    const agent = new Agent({
      connect: { timeout: connectTimeout, lookup: pinnedLookup(target.address, target.family) },
      connections: 1,
      pipelining: 0,
    })
    try {
      const res = await request(target.url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
        body,
        dispatcher: agent,
        signal,
        headersTimeout: total,
        bodyTimeout: total,
      })
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        await res.body.dump()
        if (hop >= maxRedirects)
          throw new SafeFetchError(
            'WEBHOOK_TOO_MANY_REDIRECTS',
            `More than ${maxRedirects} redirects.`,
          )
        const location = String(res.headers.location)
        current = new URL(location, target.url).toString()
        if (
          res.statusCode === 303 ||
          ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')
        ) {
          method = 'GET'
          body = undefined
        }
        // Credentials never follow a redirect to another origin.
        if (new URL(current).origin !== target.url.origin)
          for (const k of Object.keys(headers)) if (isSecretHeader(k)) delete headers[k]
        continue
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of res.body) {
        size += (chunk as Buffer).length
        if (size > maxBytes) {
          res.body.destroy()
          throw new SafeFetchError(
            'WEBHOOK_RESPONSE_TOO_LARGE',
            `The response is larger than ${Math.round(maxBytes / 1024)} KB.`,
          )
        }
        chunks.push(chunk as Buffer)
      }
      const outHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers))
        if (v !== undefined) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
      return {
        status: res.statusCode,
        headers: outHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
        durationMs: Date.now() - started,
        finalUrl: target.url.toString(),
        redirects: hop,
      }
    } catch (err) {
      if (err instanceof SafeFetchError) throw err
      if (signal.aborted)
        throw new SafeFetchError('WEBHOOK_TIMEOUT', `No response within ${total} ms.`)
      const code = (err as { code?: string }).code
      if (
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_HEADERS_TIMEOUT' ||
        code === 'UND_ERR_BODY_TIMEOUT'
      )
        throw new SafeFetchError('WEBHOOK_TIMEOUT', 'The webhook timed out.')
      throw new SafeFetchError(
        'WEBHOOK_NETWORK_ERROR',
        `The webhook call failed (${code ?? (err as Error).message}).`,
      )
    } finally {
      void agent.close().catch(() => undefined)
    }
  }
}

// ------------------------------------------------------------------------------ redaction

const SECRET_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|key|signature|password|credential/i
export const isSecretHeader = (name: string) => SECRET_HEADER.test(name)

/** Header values safe to store in history and logs. */
export function redactHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, isSecretHeader(k) ? '[REDACTED]' : v]),
  )
}

/** Query-string values of secret-looking parameters are redacted too. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const k of [...url.searchParams.keys()])
      if (isSecretHeader(k)) url.searchParams.set(k, '[REDACTED]')
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
    }
    return url.toString()
  } catch {
    return raw.slice(0, 200)
  }
}
