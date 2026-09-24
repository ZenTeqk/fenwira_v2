import { GraphError } from './errors'
import { type GraphConfig, graphUrl } from './graph'

/**
 * Typed Meta Graph API client (docs/META_INTEGRATION.md → Graph endpoints). It never reads the
 * database: callers pass the decrypted token per call. Tokens travel only in the Authorization
 * header (or, for the code exchange, the app secret in the query as Meta requires) and are never
 * included in error messages.
 */
export type GraphClientOptions = GraphConfig & { timeoutMs?: number; fetch?: typeof fetch }

export type WabaDetails = {
  id: string
  name: string
  currency?: string
  timezone_id?: string
  message_template_namespace?: string
}

export type PhoneNumberDetails = {
  id: string
  display_phone_number: string
  verified_name: string
  quality_rating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | string
  messaging_limit_tier?: string
  throughput?: { level?: string }
  status?: string
  code_verification_status?: string
}

export type TokenInfo = {
  appId?: string
  isValid: boolean
  /** Unix seconds; 0 = never expires (typical for business integration system user tokens). */
  expiresAt: number
  scopes: string[]
  /** Asset ids each granular scope was granted for (WABA ids for whatsapp_* scopes). */
  granularTargets: Record<string, string[]>
}

export type SendResult = { messageId: string }

export class GraphClient {
  private readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(private readonly options: GraphClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.doFetch = options.fetch ?? fetch
  }

  /** Embedded Signup: code → business integration system user token. */
  async exchangeCode(appId: string, appSecret: string, code: string): Promise<string> {
    const body = await this.request<{ access_token: string }>(
      'GET',
      'oauth/access_token',
      undefined,
      {
        query: { client_id: appId, client_secret: appSecret, code },
      },
    )
    return body.access_token
  }

  /** Inspect a token. `appToken` is `appId|appSecret` when available, else the token itself. */
  async debugToken(inputToken: string, appToken: string): Promise<TokenInfo> {
    const body = await this.request<{
      data: {
        app_id?: string
        is_valid: boolean
        expires_at?: number
        scopes?: string[]
        granular_scopes?: Array<{ scope: string; target_ids?: string[] }>
      }
    }>('GET', 'debug_token', appToken, { query: { input_token: inputToken } })
    const d = body.data
    return {
      appId: d.app_id,
      isValid: d.is_valid,
      expiresAt: d.expires_at ?? 0,
      scopes: d.scopes ?? [],
      granularTargets: Object.fromEntries(
        (d.granular_scopes ?? []).map((g) => [g.scope, g.target_ids ?? []]),
      ),
    }
  }

  getWaba(token: string, wabaId: string): Promise<WabaDetails> {
    return this.request('GET', wabaId, token, {
      query: { fields: 'id,name,currency,timezone_id,message_template_namespace' },
    })
  }

  async listPhoneNumbers(token: string, wabaId: string): Promise<PhoneNumberDetails[]> {
    const body = await this.request<{ data: PhoneNumberDetails[] }>(
      'GET',
      `${wabaId}/phone_numbers`,
      token,
      {
        query: {
          fields:
            'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,status',
        },
      },
    )
    return body.data
  }

  getPhoneNumber(token: string, phoneNumberId: string): Promise<PhoneNumberDetails> {
    return this.request('GET', phoneNumberId, token, {
      query: {
        fields:
          'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,status',
      },
    })
  }

  async subscribeApp(token: string, wabaId: string): Promise<void> {
    await this.request('POST', `${wabaId}/subscribed_apps`, token)
  }

  async unsubscribeApp(token: string, wabaId: string): Promise<void> {
    await this.request('DELETE', `${wabaId}/subscribed_apps`, token)
  }

  async registerPhoneNumber(token: string, phoneNumberId: string, pin: string): Promise<void> {
    await this.request('POST', `${phoneNumberId}/register`, token, {
      json: { messaging_product: 'whatsapp', pin },
    })
  }

  /**
   * Phase 4 "Test connection" only: sends Meta's built-in `hello_world` template directly.
   * TODO(phase-5): route through MessagingService → whatsapp.outbound; no other caller may send.
   */
  async sendTestTemplate(token: string, phoneNumberId: string, to: string): Promise<SendResult> {
    const body = await this.request<{ messages?: Array<{ id: string }> }>(
      'POST',
      `${phoneNumberId}/messages`,
      token,
      {
        json: {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: { name: 'hello_world', language: { code: 'en_US' } },
        },
      },
    )
    return { messageId: body.messages?.[0]?.id ?? '' }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string | undefined,
    opts: { query?: Record<string, string>; json?: unknown } = {},
  ): Promise<T> {
    const url = graphUrl(this.options, path, opts.query)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await this.doFetch(url, {
        method,
        headers,
        body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new GraphError(
        timedOut ? `Meta did not respond within ${this.timeoutMs} ms` : 'Could not reach Meta',
        undefined,
        undefined,
      )
    }
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const e = (
        body as {
          error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
        } | null
      )?.error
      throw new GraphError(
        e?.message ?? `Meta returned HTTP ${res.status}`,
        res.status,
        e?.code,
        e?.error_subcode,
        e?.fbtrace_id,
      )
    }
    return body as T
  }
}
