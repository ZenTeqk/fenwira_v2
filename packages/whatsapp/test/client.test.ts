import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GraphClient, GraphError } from '../src'
import { DEMO_PHONE_ID, DEMO_WABA_ID, type MetaMockState, startMetaMock } from '../src/testing'

let server: Server
let state: MetaMockState
let client: GraphClient
let mockUrl: string

const control = (action: string, body: unknown) =>
  fetch(`${mockUrl}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

beforeAll(async () => {
  const mock = await startMetaMock(0)
  server = mock.server
  state = mock.state
  mockUrl = mock.url
  client = new GraphClient({ baseUrl: mock.url, version: 'v23.0', timeoutMs: 2000 })
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => control('reset', {}))

describe('GraphClient against meta-mock', () => {
  it('runs the Embedded Signup sequence', async () => {
    const token = await client.exchangeCode('app', 'secret', `code-for:${DEMO_WABA_ID}`)
    expect(token).toMatch(/^mock-token:/)
    const info = await client.debugToken(token, 'app|secret')
    expect(info.isValid).toBe(true)
    expect(info.granularTargets.whatsapp_business_management).toEqual([DEMO_WABA_ID])
    expect((await client.getWaba(token, DEMO_WABA_ID)).name).toContain('Demo')
    const phones = await client.listPhoneNumbers(token, DEMO_WABA_ID)
    expect(phones.map((p) => p.id)).toEqual([DEMO_PHONE_ID])
    await client.subscribeApp(token, DEMO_WABA_ID)
    await client.registerPhoneNumber(token, DEMO_PHONE_ID, '123456')
    expect((await client.sendTestTemplate(token, DEMO_PHONE_ID, '15550100002')).messageId).toMatch(
      /^wamid\./,
    )
    const register = state.calls.find((c) => c.path.endsWith('/register'))
    expect(register?.authorization).toBe(`Bearer ${token}`)
  })

  it('classifies revoked tokens as CREDENTIAL without leaking the token', async () => {
    const token = `mock-dev:${DEMO_WABA_ID}`
    await control('revoke', { token })
    const err = await client.getPhoneNumber(token, DEMO_PHONE_ID).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GraphError)
    expect((err as GraphError).classification).toBe('CREDENTIAL')
    expect(String((err as GraphError).message)).not.toContain(token)
  })

  it('surfaces injected rate limits as RETRYABLE_RATE', async () => {
    await control('fail', {
      pathContains: 'phone_numbers',
      status: 429,
      code: 130429,
      message: 'Rate',
    })
    const err = await client
      .listPhoneNumbers(`mock-dev:${DEMO_WABA_ID}`, DEMO_WABA_ID)
      .catch((e: unknown) => e)
    expect((err as GraphError).classification).toBe('RETRYABLE_RATE')
    // The injected failure is consumed once.
    await expect(
      client.listPhoneNumbers(`mock-dev:${DEMO_WABA_ID}`, DEMO_WABA_ID),
    ).resolves.toHaveLength(1)
  })

  it('reports unreachable hosts as retryable META_UNAVAILABLE', async () => {
    const dead = new GraphClient({
      baseUrl: 'http://127.0.0.1:1',
      version: 'v23.0',
      timeoutMs: 500,
    })
    const err = await dead.getWaba('t', '1').catch((e: unknown) => e)
    expect((err as GraphError).fenwiraCode).toBe('META_UNAVAILABLE')
    expect((err as GraphError).retryable).toBe(true)
  })

  it('rejects tokens scoped to another WABA', async () => {
    await control('seed', { wabaId: '100000000000009', phones: [{ id: '200000000000009' }] })
    const err = await client
      .getWaba(`mock-dev:${DEMO_WABA_ID}`, '100000000000009')
      .catch((e: unknown) => e)
    expect((err as GraphError).classification).toBe('CREDENTIAL')
  })
})
