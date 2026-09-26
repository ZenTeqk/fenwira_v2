import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isInternalHostname,
  isPublicAddress,
  redactHeaders,
  redactUrl,
  safeFetch,
  SafeFetchError,
  validateDestination,
} from '../src/core/http/safe-fetch'

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (err) {
    return err instanceof SafeFetchError ? err.code : `unexpected: ${(err as Error).message}`
  }
}

describe('SSRF address rules (P10-D4)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    '2001:db8::1',
  ])('blocks %s', (a) => expect(isPublicAddress(a)).toBe(false))

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (a) => expect(isPublicAddress(a)).toBe(true),
  )

  it.each([
    'localhost',
    'api.localhost',
    'printer.local',
    'db.internal',
    'metadata.google.internal',
    'metadata',
    'intranet',
    'router.home.arpa',
  ])('treats %s as internal', (h) => expect(isInternalHostname(h)).toBe(true))

  it('rejects http, credentials and internal names before any lookup', async () => {
    let lookups = 0
    const resolve = async () => {
      lookups++
      return [{ address: '93.184.216.34', family: 4 }]
    }
    expect(await code(validateDestination('http://example.com/x', { resolve }))).toBe(
      'WEBHOOK_URL_INVALID',
    )
    expect(await code(validateDestination('https://u:p@example.com/x', { resolve }))).toBe(
      'WEBHOOK_URL_INVALID',
    )
    expect(await code(validateDestination('ftp://example.com', { resolve }))).toBe(
      'WEBHOOK_URL_INVALID',
    )
    expect(await code(validateDestination('https://localhost:4000', { resolve }))).toBe(
      'WEBHOOK_BLOCKED_DESTINATION',
    )
    expect(await code(validateDestination('https://169.254.169.254/latest', { resolve }))).toBe(
      'WEBHOOK_BLOCKED_DESTINATION',
    )
    expect(await code(validateDestination('https://[::1]/', { resolve }))).toBe(
      'WEBHOOK_BLOCKED_DESTINATION',
    )
    expect(lookups).toBe(0)
  })

  it('refuses a host when any resolved address is private (rebinding)', async () => {
    const resolve = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]
    expect(await code(validateDestination('https://mixed.example.com', { resolve }))).toBe(
      'WEBHOOK_BLOCKED_DESTINATION',
    )
  })

  it('accepts a public host and returns the address to pin', async () => {
    const t = await validateDestination('https://hooks.example.com/a', {
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    })
    expect(t.address).toBe('93.184.216.34')
  })

  it('redacts secret headers and query values', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer x',
        'X-Api-Key': 'k',
        'X-Signature': 's',
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
      'X-Signature': '[REDACTED]',
      'Content-Type': 'application/json',
    })
    expect(redactUrl('https://a.example.com/x?token=abc&q=1')).toBe(
      'https://a.example.com/x?token=%5BREDACTED%5D&q=1',
    )
  })
})

describe('safeFetch against a local receiver (dev-host exception)', () => {
  let server: Server
  let port = 0
  let hits: string[] = []
  const dev = { devHosts: ['hook.test.example'] }
  // The receiver name exists in no DNS: reaching it proves the connection is pinned to the
  // address this resolver returned.
  const resolve = async () => [{ address: '127.0.0.1', family: 4 }]
  const url = (path: string) => `http://hook.test.example:${port}${path}`

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url} ${req.headers['idempotency-key'] ?? ''}`)
      if (req.url === '/ok') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
      } else if (req.url === '/redirect')
        res.writeHead(302, { location: `http://hook.test.example:${port}/ok` }).end()
      else if (req.url === '/loop') res.writeHead(302, { location: '/loop' }).end()
      else if (req.url === '/escape')
        res.writeHead(307, { location: 'https://169.254.169.254/latest/meta-data' }).end()
      else if (req.url === '/big') res.end('x'.repeat(70 * 1024))
      else if (req.url === '/slow') setTimeout(() => res.end('late'), 2000)
      else res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('posts JSON and reads the response', async () => {
    hits = []
    const res = await safeFetch(
      { method: 'POST', url: url('/ok'), body: '{"a":1}', headers: { 'Idempotency-Key': 'k1' } },
      { ...dev, resolve },
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(hits).toEqual(['POST /ok k1'])
  })

  it('follows a redirect, re-validating the hop (POST → GET on 302)', async () => {
    hits = []
    const res = await safeFetch(
      { method: 'POST', url: url('/redirect'), body: '{}' },
      { ...dev, resolve },
    )
    expect(res.status).toBe(200)
    expect(res.redirects).toBe(1)
    expect(hits).toEqual(['POST /redirect ', 'GET /ok '])
  })

  it('refuses a redirect into a blocked range', async () => {
    expect(await code(safeFetch({ method: 'GET', url: url('/escape') }, { ...dev, resolve }))).toBe(
      'WEBHOOK_BLOCKED_DESTINATION',
    )
  })

  it('stops after 3 redirects', async () => {
    expect(await code(safeFetch({ method: 'GET', url: url('/loop') }, { ...dev, resolve }))).toBe(
      'WEBHOOK_TOO_MANY_REDIRECTS',
    )
  })

  it('caps the response size', async () => {
    expect(await code(safeFetch({ method: 'GET', url: url('/big') }, { ...dev, resolve }))).toBe(
      'WEBHOOK_RESPONSE_TOO_LARGE',
    )
  })

  it('times out', async () => {
    expect(
      await code(
        safeFetch({ method: 'GET', url: url('/slow'), timeoutMs: 300 }, { ...dev, resolve }),
      ),
    ).toBe('WEBHOOK_TIMEOUT')
  })

  it('without the dev exception, the same receiver is refused', async () => {
    expect(await code(safeFetch({ method: 'GET', url: url('/ok') }, { resolve }))).toBe(
      'WEBHOOK_URL_INVALID',
    )
    expect(
      await code(
        safeFetch({ method: 'GET', url: `https://hook.test.example:${port}/ok` }, { resolve }),
      ),
    ).toBe('WEBHOOK_BLOCKED_DESTINATION')
  })
})
