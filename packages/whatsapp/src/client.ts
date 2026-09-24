import { type GraphClientOptions, GraphHttp } from './http'

export type { GraphClientOptions } from './http'

/**
 * Typed Meta Graph API client for account management and media reads (docs/META_INTEGRATION.md →
 * Graph endpoints). It never reads the database: callers pass the decrypted token per call.
 * Sending lives in `@fenwira/whatsapp/send`, which only the outbound worker may import.
 */

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

export class GraphClient {
  private readonly http: GraphHttp

  constructor(options: GraphClientOptions) {
    this.http = new GraphHttp(options)
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

  /** Media metadata; `url` is short-lived and must be fetched with the same token. */
  getMediaUrl(
    token: string,
    mediaId: string,
  ): Promise<{ url: string; mime_type?: string; file_size?: number; sha256?: string }> {
    return this.request('GET', mediaId, token)
  }

  downloadMedia(token: string, url: string): Promise<{ bytes: Buffer; mimeType?: string }> {
    return this.http.download(url, token)
  }

  private request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string | undefined,
    opts: { query?: Record<string, string>; json?: unknown } = {},
  ): Promise<T> {
    return this.http.request<T>(method, path, token, opts)
  }
}
