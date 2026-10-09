import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  NativeProviders,
  type NativeTransport,
} from '../src/modules/native-connectors/native.providers'
import { type SafeResponse } from '../src/core/http/safe-fetch'
const reply = (body: unknown, status = 200): SafeResponse => ({
  status,
  headers: {},
  body: JSON.stringify(body),
  durationMs: 1,
  finalUrl: 'https://example.com',
  redirects: 0,
})
const apps = {
  GOOGLE_SHEETS: { clientId: 'google-id', clientSecret: 'google-secret' },
  ZOHO_CRM: { clientId: 'zoho-id', clientSecret: 'zoho-secret' },
  SHOPIFY: { clientId: 'shop-id', clientSecret: 'shop-secret' },
}
const make = (send: NativeTransport) =>
  new NativeProviders(apps, 'https://fenwira.test/integrations/native/callback', send)

describe('native provider boundary', () => {
  it('bounds ERP sites and Shopify stores before making a request', () => {
    const p = make(vi.fn())
    for (const site of [
      'https://user:secret@erp.example.com',
      'http://erp.example.com',
      'https://erp.example.com/path',
      'https://erp.example.com?token=x',
    ])
      expect(() => p.site({ provider: 'ERPNEXT', label: 'ERP', region: 'com', site })).toThrow()
    for (const site of [
      'attacker.example.com',
      'shop.myshopify.com.attacker.test',
      'shop.myshopify.com/path',
    ])
      expect(() => p.site({ provider: 'SHOPIFY', label: 'Shop', region: 'com', site })).toThrow()
  })
  it('Google requests offline access, state and PKCE at a fixed provider origin', () => {
    const p = make(vi.fn())
    const u = new URL(
      p.authorize(
        { provider: 'GOOGLE_SHEETS', label: 'Sheets', region: 'com' },
        'nonce',
        'verifier',
      ),
    )
    expect(u.origin).toBe('https://accounts.google.com')
    expect(u.searchParams.get('state')).toBe('nonce')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('access_type')).toBe('offline')
  })
  it('Zoho regional endpoints are selected from the contract enum', () => {
    const p = make(vi.fn())
    const u = new URL(
      p.authorize({ provider: 'ZOHO_CRM', label: 'CRM', region: 'in' }, 'nonce', 'verifier'),
    )
    expect(u.origin).toBe('https://accounts.zoho.in')
    expect(u.searchParams.get('scope')).toBe('ZohoCRM.modules.contacts.READ')
  })
  it('rejects unauthenticated ERP responses without leaking payloads', async () => {
    const p = make(async () => reply({ message: 'private phone email secret' }, 403))
    await expect(
      p.verifyErp('https://erp.example.com', { apiKey: 'key', apiSecret: 'secret' }),
    ).rejects.toThrow('PROVIDER_PERMISSION_DENIED')
  })
  it('normalizes provider records without copying consent or other CRM fields', async () => {
    const send = vi.fn<NativeTransport>(async () =>
      reply({
        data: [
          {
            first_name: 'Priya',
            last_name: 'S',
            mobile_no: '+919876543210',
            email_id: 'priya@example.com',
            marketing_consent: true,
            private_notes: 'private',
          },
        ],
      }),
    )
    const p = make(send)
    expect(
      await p.people('ERPNEXT', 'https://erp.example.com', 'com', { apiKey: 'k', apiSecret: 's' }),
    ).toEqual([{ phone: '+919876543210', name: 'Priya S', email: 'priya@example.com' }])
    expect(send.mock.calls[0]![0].headers?.authorization).toBe('token k:s')
  })
  it('paginates Shopify customers with an opaque cursor', async () => {
    const send = vi.fn<NativeTransport>(async () =>
      reply({ data: { customers: { nodes: [], pageInfo: { hasNextPage: false } } } }),
    )
    await make(send).people('SHOPIFY', 'https://textiles.myshopify.com', 'com', {
      accessToken: 'secret',
    })
    expect(send.mock.calls[0]![0].url).toContain('/2026-07/graphql.json')
  })
  it('validates Shopify callback HMAC, store and timestamp before token exchange', async () => {
    const send = vi.fn<NativeTransport>(async () =>
      reply({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
    )
    const p = make(send)
    const input = {
      provider: 'SHOPIFY' as const,
      label: 'Shop',
      region: 'com' as const,
      site: 'textiles.myshopify.com',
    }
    const body = {
      state: 'nonce',
      code: 'code',
      shop: 'textiles.myshopify.com',
      timestamp: String(Math.floor(Date.now() / 1000)),
      host: 'host',
    }
    const signature = createHmac('sha256', 'shop-secret')
      .update(
        Object.entries(body)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('&'),
      )
      .digest('hex')
    await expect(p.exchange(input, { ...body, hmac: 'bad' }, 'verifier')).rejects.toThrow(
      'INVALID_SHOPIFY_CALLBACK',
    )
    expect(send).not.toHaveBeenCalled()
    const token = await p.exchange(input, { ...body, hmac: signature }, 'verifier')
    expect(token.refreshToken).toBe('refresh')
    expect(send.mock.calls[0]![0].body).toContain('expiring=1')
  })
  it('retains rotated refresh tokens and fails closed without offline access', async () => {
    const send = vi.fn<NativeTransport>(async () =>
      reply({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
    )
    const result = await make(send).refresh('GOOGLE_SHEETS', null, 'com', {
      accessToken: 'old',
      refreshToken: 'old-refresh',
      expiresAt: 0,
    })
    expect(result.refreshToken).toBe('rotated')
    const noRefresh = make(async () => reply({ access_token: 'online-only' }))
    await expect(
      noRefresh.exchange(
        { provider: 'GOOGLE_SHEETS', label: 'Sheets', region: 'com' },
        { state: 'nonce', code: 'code' },
        'verifier',
      ),
    ).rejects.toThrow('OFFLINE_ACCESS_REQUIRED')
  })
  it('Sheets retries use the same dedicated tab/range and RAW values', async () => {
    const title = 'Fenwira Contacts receipt'
    const send = vi.fn<NativeTransport>(async (request) =>
      reply(request.method === 'GET' ? { sheets: [{ properties: { title } }] } : {}),
    )
    const rows = [
      [title],
      ['ID', 'Phone', 'Name', 'Email'],
      ['id', '+919876543210', '=dangerous()', 'email@example.com'],
    ]
    const p = make(send)
    await p.exportSheet({ accessToken: 'access' }, 'spreadsheet-id', rows)
    await p.exportSheet({ accessToken: 'access' }, 'spreadsheet-id', rows)
    const writes = send.mock.calls.map(([r]) => r).filter((r) => r.method === 'PUT')
    expect(writes).toHaveLength(2)
    expect(writes[0]!.url).toBe(writes[1]!.url)
    expect(writes[0]!.body).toBe(writes[1]!.body)
    expect(writes[0]!.url).toContain('valueInputOption=RAW')
    expect(send.mock.calls.some(([r]) => r.url.includes(':append'))).toBe(false)
  })
})
