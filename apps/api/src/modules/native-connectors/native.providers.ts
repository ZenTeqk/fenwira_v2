import { createHash, createHmac } from 'node:crypto'
import { safeEqual } from '@fenwira/config'
import { type NativeProvider, type NativeSetup, type NativeCallback } from '@fenwira/contracts'
import { safeFetch, type SafeRequest, type SafeResponse } from '../../core/http/safe-fetch'

export type OAuthApp = { clientId: string; clientSecret: string }
export type NativeApps = Partial<Record<Exclude<NativeProvider, 'ERPNEXT'>, OAuthApp>>
export type NativeSecrets = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  apiKey?: string
  apiSecret?: string
}
export type NativePerson = { phone: string; name: string; email: string }
export class NativeProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'NativeProviderError'
  }
}
export type NativeTransport = (request: SafeRequest) => Promise<SafeResponse>
const transport: NativeTransport = (request) =>
  safeFetch(request, {
    maxRedirects: 0,
    maxResponseBytes: 1024 * 1024,
    maxTotalMs: 10_000,
  })
const cleanPerson = (phone: unknown, name: unknown, email: unknown): NativePerson => ({
  phone: typeof phone === 'string' ? phone.slice(0, 80) : '',
  name: typeof name === 'string' ? name.slice(0, 200) : '',
  email: typeof email === 'string' ? email.slice(0, 254) : '',
})
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const records = (v: unknown) => (Array.isArray(v) ? v.map(obj) : [])

/** Provider-specific networking. No raw errors, tokens or contact payloads leave this boundary. */
export class NativeProviders {
  constructor(
    readonly apps: NativeApps,
    readonly callbackUrl: string,
    private readonly send: NativeTransport = transport,
  ) {}

  site(input: NativeSetup): string | null {
    if (input.provider === 'SHOPIFY') {
      const host = (input.site ?? '')
        .replace(/^https:\/\//, '')
        .replace(/\/$/, '')
        .toLowerCase()
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host))
        throw new NativeProviderError('INVALID_SHOP')
      return `https://${host}`
    }
    if (input.provider !== 'ERPNEXT') return null
    const url = new URL(input.site ?? '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new NativeProviderError('INVALID_SITE')
    return url.origin
  }

  private app(provider: NativeProvider): OAuthApp {
    const app = provider === 'ERPNEXT' ? undefined : this.apps[provider]
    if (!app) throw new NativeProviderError('OAUTH_NOT_CONFIGURED')
    return app
  }

  private async json(request: SafeRequest): Promise<Record<string, unknown>> {
    try {
      const response = await this.send(request)
      if (response.status === 401 || response.status === 403)
        throw new NativeProviderError('PROVIDER_PERMISSION_DENIED')
      if (response.status < 200 || response.status >= 300)
        throw new NativeProviderError('PROVIDER_UNAVAILABLE')
      if (response.status === 204) return {}
      const result = obj(JSON.parse(response.body))
      if (result.error || result.errors) throw new NativeProviderError('PROVIDER_REQUEST_FAILED')
      return result
    } catch (error) {
      if (error instanceof NativeProviderError) throw error
      throw new NativeProviderError('PROVIDER_REQUEST_FAILED')
    }
  }

  authorize(input: NativeSetup, state: string, verifier: string): string {
    const app = this.app(input.provider)
    const url = new URL(
      input.provider === 'GOOGLE_SHEETS'
        ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : input.provider === 'ZOHO_CRM'
          ? `https://accounts.zoho.${input.region}/oauth/v2/auth`
          : `${this.site(input)}/admin/oauth/authorize`,
    )
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('redirect_uri', this.callbackUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    if (input.provider === 'GOOGLE_SHEETS') {
      url.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets')
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      url.searchParams.set(
        'code_challenge',
        createHash('sha256').update(verifier).digest('base64url'),
      )
      url.searchParams.set('code_challenge_method', 'S256')
    } else if (input.provider === 'ZOHO_CRM') {
      url.searchParams.set('scope', 'ZohoCRM.modules.contacts.READ')
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
    } else url.searchParams.set('scope', 'read_customers')
    return url.toString()
  }

  private tokenUrl(provider: NativeProvider, site: string | null, region: string): string {
    return provider === 'GOOGLE_SHEETS'
      ? 'https://oauth2.googleapis.com/token'
      : provider === 'ZOHO_CRM'
        ? `https://accounts.zoho.${region}/oauth/v2/token`
        : `${site}/admin/oauth/access_token`
  }

  async exchange(
    input: NativeSetup,
    body: NativeCallback,
    verifier: string,
  ): Promise<NativeSecrets> {
    const app = this.app(input.provider)
    const site = this.site(input)
    if (input.provider === 'SHOPIFY') {
      if (
        `https://${body.shop}` !== site ||
        !body.hmac ||
        !body.timestamp ||
        !Number.isFinite(Number(body.timestamp)) ||
        Math.abs(Date.now() / 1000 - Number(body.timestamp)) > 300
      )
        throw new NativeProviderError('INVALID_SHOPIFY_CALLBACK')
      const params = Object.entries(body)
        .filter(([k, v]) => k !== 'hmac' && v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
      const message = params.map(([k, v]) => `${k}=${v}`).join('&')
      const signature = createHmac('sha256', app.clientSecret).update(message).digest('hex')
      if (!safeEqual(signature, body.hmac))
        throw new NativeProviderError('INVALID_SHOPIFY_CALLBACK')
    }
    const values: Record<string, string> = {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: body.code,
      grant_type: 'authorization_code',
      redirect_uri: this.callbackUrl,
    }
    if (input.provider === 'GOOGLE_SHEETS') values.code_verifier = verifier
    if (input.provider === 'SHOPIFY') values.expiring = '1'
    const response = await this.json({
      method: 'POST',
      url: this.tokenUrl(input.provider, site, input.region),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    })
    if (!text(response.access_token) || !text(response.refresh_token))
      throw new NativeProviderError('OFFLINE_ACCESS_REQUIRED')
    return {
      accessToken: text(response.access_token),
      refreshToken: text(response.refresh_token),
      expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
    }
  }

  async refresh(
    provider: NativeProvider,
    site: string | null,
    region: string,
    secrets: NativeSecrets,
  ): Promise<NativeSecrets> {
    if (provider === 'ERPNEXT' || (secrets.expiresAt ?? 0) > Date.now() + 60_000) return secrets
    const app = this.app(provider)
    if (!secrets.refreshToken) throw new NativeProviderError('RECONNECT_REQUIRED')
    const response = await this.json({
      method: 'POST',
      url: this.tokenUrl(provider, site, region),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: secrets.refreshToken,
      }).toString(),
    })
    if (!text(response.access_token)) throw new NativeProviderError('RECONNECT_REQUIRED')
    return {
      ...secrets,
      accessToken: text(response.access_token),
      refreshToken: text(response.refresh_token) || secrets.refreshToken,
      expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
    }
  }

  async verifyErp(site: string, secrets: NativeSecrets): Promise<void> {
    const result = await this.json({
      method: 'GET',
      url: `${site}/api/method/frappe.auth.get_logged_user`,
      headers: { authorization: `token ${secrets.apiKey}:${secrets.apiSecret}` },
    })
    if (!text(result.message) || result.message === 'Guest')
      throw new NativeProviderError('PROVIDER_PERMISSION_DENIED')
  }

  async people(
    provider: NativeProvider,
    site: string | null,
    region: string,
    secrets: NativeSecrets,
  ): Promise<NativePerson[]> {
    const result: NativePerson[] = []
    let cursor: string | null = null
    for (let page = 1; page <= 101; page++) {
      let more = false
      if (provider === 'ERPNEXT') {
        const url = new URL(`${site}/api/resource/Contact`)
        url.searchParams.set(
          'fields',
          JSON.stringify(['name', 'first_name', 'last_name', 'mobile_no', 'phone', 'email_id']),
        )
        url.searchParams.set('order_by', 'name asc')
        url.searchParams.set('limit_start', String((page - 1) * 100))
        url.searchParams.set('limit_page_length', '100')
        const response = await this.json({
          method: 'GET',
          url: url.toString(),
          headers: { authorization: `token ${secrets.apiKey}:${secrets.apiSecret}` },
        })
        const rows = records(response.data)
        result.push(
          ...rows.map((r) =>
            cleanPerson(
              r.mobile_no || r.phone,
              `${text(r.first_name)} ${text(r.last_name)}`.trim(),
              r.email_id,
            ),
          ),
        )
        more = rows.length === 100
      } else if (provider === 'ZOHO_CRM') {
        const url = new URL(`https://www.zohoapis.${region}/crm/v8/Contacts`)
        url.searchParams.set('fields', 'First_Name,Last_Name,Phone,Mobile,Email')
        if (cursor) url.searchParams.set('page_token', cursor)
        else url.searchParams.set('page', String(page))
        url.searchParams.set('per_page', '100')
        const response = await this.json({
          method: 'GET',
          url: url.toString(),
          headers: { authorization: `Zoho-oauthtoken ${secrets.accessToken}` },
        })
        result.push(
          ...records(response.data).map((r) =>
            cleanPerson(
              r.Mobile || r.Phone,
              `${text(r.First_Name)} ${text(r.Last_Name)}`.trim(),
              r.Email,
            ),
          ),
        )
        const info = obj(response.info)
        more = info.more_records === true
        cursor = text(info.next_page_token) || null
        if (more && page >= 20 && !cursor)
          throw new NativeProviderError('INVALID_PROVIDER_RESPONSE')
      } else if (provider === 'SHOPIFY') {
        const response = await this.json({
          method: 'POST',
          url: `${site}/admin/api/2026-07/graphql.json`,
          headers: { 'X-Shopify-Access-Token': secrets.accessToken! },
          body: JSON.stringify({
            query:
              'query($after:String){customers(first:100,after:$after,sortKey:ID){nodes{firstName lastName defaultPhoneNumber{phoneNumber} defaultEmailAddress{emailAddress}} pageInfo{hasNextPage endCursor}}}',
            variables: { after: cursor },
          }),
        })
        const customers = obj(obj(response.data).customers)
        result.push(
          ...records(customers.nodes).map((r) =>
            cleanPerson(
              obj(r.defaultPhoneNumber).phoneNumber,
              `${text(r.firstName)} ${text(r.lastName)}`.trim(),
              obj(r.defaultEmailAddress).emailAddress,
            ),
          ),
        )
        const info = obj(customers.pageInfo)
        more = info.hasNextPage === true
        cursor = text(info.endCursor)
        if (more && !cursor) throw new NativeProviderError('INVALID_PROVIDER_RESPONSE')
      } else throw new NativeProviderError('IMPORT_UNSUPPORTED')
      if (result.length > 10000) throw new NativeProviderError('IMPORT_LIMIT_EXCEEDED')
      if (!more) return result
    }
    throw new NativeProviderError('IMPORT_LIMIT_EXCEEDED')
  }

  async exportSheet(
    secrets: NativeSecrets,
    spreadsheetId: string,
    rows: string[][],
  ): Promise<void> {
    // A dedicated new tab per immutable transfer snapshot avoids touching unrelated cells.
    // The caller gives a deterministic tab title; AddSheet conflicts are verified via metadata.
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
    const auth = { authorization: `Bearer ${secrets.accessToken}` }
    const meta = await this.json({
      method: 'GET',
      url: `${url}?fields=sheets.properties`,
      headers: auth,
    })
    const title = rows[0]![0]!
    const values = rows.slice(1)
    const existing = records(meta.sheets).some((s) => obj(s.properties).title === title)
    if (!existing)
      await this.json({
        method: 'POST',
        url: `${url}:batchUpdate`,
        headers: auth,
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title,
                  gridProperties: { rowCount: Math.max(1000, values.length), columnCount: 4 },
                },
              },
            },
          ],
        }),
      })
    await this.json({
      method: 'PUT',
      url: `${url}/values/${encodeURIComponent(`'${title}'!A1:D${values.length}`)}?valueInputOption=RAW`,
      headers: auth,
      body: JSON.stringify({
        range: `'${title}'!A1:D${values.length}`,
        majorDimension: 'ROWS',
        values,
      }),
    })
  }
}
