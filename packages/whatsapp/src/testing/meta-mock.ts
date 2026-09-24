import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * Simulated Meta Graph API for local development and tests (docs/META_INTEGRATION.md → Testing).
 * It implements the endpoints Fenwira calls with realistic shapes, plus `/__mock/*` control routes
 * to seed accounts, inject errors, revoke tokens and inspect received calls.
 *
 * Token conventions (never real credentials):
 *  - Embedded Signup codes `code-for:<wabaId>` exchange to `mock-token:<wabaId>:<n>`; code `invalid` fails.
 *  - Dev-connect tokens `mock-dev:<wabaId>` are granted on that WABA.
 *  - Tokens containing `expiring` expire in 3 days; revoked tokens fail with code 190.
 */
type Phone = {
  id: string
  display_phone_number: string
  verified_name: string
  quality_rating: string
  messaging_limit_tier: string
  status: string
}
type Waba = {
  id: string
  name: string
  currency: string
  timezone_id: string
  phones: Map<string, Phone>
}
type Failure = {
  method?: string
  pathContains: string
  status: number
  code: number
  message: string
  times: number
}
export type MockCall = { method: string; path: string; authorization?: string; body?: unknown }

export type MetaMockState = {
  wabas: Map<string, Waba>
  revoked: Set<string>
  failures: Failure[]
  calls: MockCall[]
  exchanges: number
}

export const DEMO_WABA_ID = '100000000000001'
export const DEMO_PHONE_ID = '200000000000001'

function seedDemo(state: MetaMockState): void {
  seedWaba(state, {
    wabaId: DEMO_WABA_ID,
    name: 'Fenwira Demo (simulated)',
    phones: [{ id: DEMO_PHONE_ID, display: '+1 555-010-0001', verifiedName: 'Fenwira Demo' }],
  })
}

function seedWaba(
  state: MetaMockState,
  input: {
    wabaId: string
    name?: string
    phones: Array<{
      id: string
      display?: string
      verifiedName?: string
      quality?: string
      status?: string
    }>
  },
): void {
  const waba: Waba = state.wabas.get(input.wabaId) ?? {
    id: input.wabaId,
    name: input.name ?? `Mock WABA ${input.wabaId}`,
    currency: 'INR',
    timezone_id: '71',
    phones: new Map(),
  }
  for (const p of input.phones) {
    waba.phones.set(p.id, {
      id: p.id,
      display_phone_number: p.display ?? `+1 555-${p.id.slice(-7, -4)}-${p.id.slice(-4)}`,
      verified_name: p.verifiedName ?? 'Mock Business',
      quality_rating: p.quality ?? 'GREEN',
      messaging_limit_tier: 'TIER_1K',
      status: p.status ?? 'CONNECTED',
    })
  }
  state.wabas.set(input.wabaId, waba)
}

export function createMetaMockState(): MetaMockState {
  const state: MetaMockState = {
    wabas: new Map(),
    revoked: new Set(),
    failures: [],
    calls: [],
    exchanges: 0,
  }
  seedDemo(state)
  return state
}

const findPhone = (state: MetaMockState, id: string) => {
  for (const waba of state.wabas.values())
    if (waba.phones.has(id)) return { waba, phone: waba.phones.get(id)! }
  return undefined
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const graphError = (res: ServerResponse, status: number, code: number, message: string) =>
  send(res, status, { error: { message, type: 'OAuthException', code, fbtrace_id: 'MockTrace' } })

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const grantedWaba = (token: string): string | undefined => {
  const m = /^mock-(?:token|dev):([^:]+)/.exec(token)
  return m?.[1]
}

export function createMetaMockHandler(state: MetaMockState) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const method = req.method ?? 'GET'
    const body = await readBody(req)

    // ---------------------------------------------------------------- control routes
    if (url.pathname.startsWith('/__mock/')) {
      const action = url.pathname.slice('/__mock/'.length)
      if (method === 'GET' && action === 'calls') return send(res, 200, { calls: state.calls })
      if (method === 'GET' && action === 'health') return send(res, 200, { ok: true })
      const input = (body ?? {}) as Record<string, unknown>
      switch (action) {
        case 'reset':
          state.wabas.clear()
          state.revoked.clear()
          state.failures = []
          state.calls = []
          seedDemo(state)
          return send(res, 200, { ok: true })
        case 'seed':
          seedWaba(state, input as never)
          return send(res, 200, { ok: true })
        case 'fail':
          state.failures.push({
            status: 500,
            code: 1,
            message: 'Injected failure',
            times: 1,
            ...(input as object),
          } as Failure)
          return send(res, 200, { ok: true })
        case 'revoke':
          state.revoked.add(String(input.token))
          return send(res, 200, { ok: true })
        case 'quality': {
          const found = findPhone(state, String(input.phoneId))
          if (!found) return send(res, 404, { error: 'unknown phone' })
          if (input.quality) found.phone.quality_rating = String(input.quality)
          if (input.tier) found.phone.messaging_limit_tier = String(input.tier)
          if (input.status) found.phone.status = String(input.status)
          return send(res, 200, { ok: true })
        }
        default:
          return send(res, 404, { error: 'unknown control route' })
      }
    }

    // ---------------------------------------------------------------- Graph API
    const parts = url.pathname.split('/').filter(Boolean)
    if (!/^v\d+\.\d+$/.test(parts[0] ?? ''))
      return graphError(res, 400, 2500, 'Unknown path components')
    const path = parts.slice(1).join('/')
    const authorization = req.headers.authorization
    state.calls.push({ method, path, authorization, body })

    const failure = state.failures.find(
      (f) => path.includes(f.pathContains) && (!f.method || f.method === method),
    )
    if (failure) {
      failure.times -= 1
      if (failure.times <= 0) state.failures.splice(state.failures.indexOf(failure), 1)
      return graphError(res, failure.status, failure.code, failure.message)
    }

    if (path === 'oauth/access_token') {
      const code = url.searchParams.get('code') ?? ''
      if (!url.searchParams.get('client_id') || !url.searchParams.get('client_secret')) {
        return graphError(res, 400, 101, 'Missing client_id or client_secret')
      }
      const wabaId = /^code-for:(.+)$/.exec(code)?.[1]
      if (!wabaId) return graphError(res, 400, 100, 'Invalid verification code format.')
      state.exchanges += 1
      return send(res, 200, {
        access_token: `mock-token:${wabaId}:${state.exchanges}`,
        token_type: 'bearer',
      })
    }

    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return graphError(res, 401, 190, 'An active access token must be used.')

    if (path === 'debug_token') {
      const input = url.searchParams.get('input_token') ?? ''
      const waba = grantedWaba(input)
      const valid = !state.revoked.has(input) && Boolean(waba)
      const expiresAt = input.includes('expiring')
        ? Math.floor(Date.now() / 1000) + 3 * 24 * 3600
        : 0
      return send(res, 200, {
        data: {
          app_id: 'mock-app',
          is_valid: valid,
          expires_at: expiresAt,
          scopes: [
            'whatsapp_business_management',
            'whatsapp_business_messaging',
            'business_management',
          ],
          granular_scopes: waba
            ? [
                { scope: 'whatsapp_business_management', target_ids: [waba] },
                { scope: 'whatsapp_business_messaging', target_ids: [waba] },
              ]
            : [],
        },
      })
    }

    if (state.revoked.has(token))
      return graphError(
        res,
        401,
        190,
        'Error validating access token: The session has been invalidated.',
      )
    const granted = grantedWaba(token)
    if (!granted) return graphError(res, 401, 190, 'Invalid OAuth access token.')

    const [first, second] = parts.slice(1)
    const waba = first ? state.wabas.get(first) : undefined
    if (waba) {
      if (waba.id !== granted) return graphError(res, 403, 200, 'Permissions error')
      if (!second && method === 'GET') {
        return send(res, 200, {
          id: waba.id,
          name: waba.name,
          currency: waba.currency,
          timezone_id: waba.timezone_id,
          message_template_namespace: `ns_${waba.id}`,
        })
      }
      if (second === 'phone_numbers' && method === 'GET') {
        return send(res, 200, {
          data: [...waba.phones.values()].map((p) => ({ ...p, throughput: { level: 'STANDARD' } })),
        })
      }
      if (second === 'subscribed_apps' && (method === 'POST' || method === 'DELETE'))
        return send(res, 200, { success: true })
    }

    const phone = first ? findPhone(state, first) : undefined
    if (phone) {
      if (phone.waba.id !== granted) return graphError(res, 403, 200, 'Permissions error')
      if (!second && method === 'GET')
        return send(res, 200, { ...phone.phone, throughput: { level: 'STANDARD' } })
      if (second === 'register' && method === 'POST') {
        phone.phone.status = 'CONNECTED'
        return send(res, 200, { success: true })
      }
      if (second === 'messages' && method === 'POST') {
        return send(res, 200, {
          messaging_product: 'whatsapp',
          contacts: [
            { input: (body as { to?: string })?.to, wa_id: (body as { to?: string })?.to },
          ],
          messages: [{ id: `wamid.mock.${Date.now()}` }],
        })
      }
    }

    return graphError(res, 400, 100, `Unsupported request: ${method} ${path}`)
  }
}

/** Starts the mock on `port` (0 = random). Used by the fenwira-meta-mock container and tests. */
export async function startMetaMock(
  port = 0,
): Promise<{ server: Server; url: string; state: MetaMockState }> {
  const state = createMetaMockState()
  const handler = createMetaMockHandler(state)
  const server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => send(res, 500, { error: String(err) }))
  })
  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return { server, url: `http://127.0.0.1:${actualPort}`, state }
}
