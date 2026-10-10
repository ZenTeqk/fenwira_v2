import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  deliverWebhook,
  inboundMessageWebhook,
  statusWebhook,
  templateStatusWebhook,
  wabaFieldWebhook,
} from './webhooks'

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
  templates: Map<string, MockTemplate>
}
export type MockTemplate = {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: Array<Record<string, unknown>>
  quality_score?: { score: string }
  rejected_reason?: string
}
/** How the simulated review answers new/edited templates (default: approve after 400 ms). */
export type TemplateReview = {
  decision: 'APPROVED' | 'REJECTED' | 'NONE'
  reason?: string
  delayMs?: number
  /** Re-categorize MARKETING-sounding UTILITY templates, like Meta may. */
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

export type SentMessage = { phoneNumberId: string; wamid: string; payload: Record<string, unknown> }
/** Where the mock posts signed webhooks (status updates after sends, simulated inbound). */
export type WebhookTarget = {
  url: string
  appSecret: string
  /** Statuses posted after each successful send, in order. Default sent, delivered, read. */
  statuses?: Array<'sent' | 'delivered' | 'read'>
  delayMs?: number
}

export type MetaMockState = {
  wabas: Map<string, Waba>
  revoked: Set<string>
  failures: Failure[]
  calls: MockCall[]
  exchanges: number
  sent: SentMessage[]
  media: Map<string, { mimeType: string; bytes: Buffer }>
  /** Slow responses for matching Graph paths (e.g. to stop a worker mid-send). */
  delays: Array<{ pathContains: string; ms: number; times: number }>
  webhookTarget?: WebhookTarget
  templateReview: TemplateReview
  uploads: Map<string, { bytes: Buffer; mimeType: string }>
  templateSeq: number
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
    templates: new Map(),
  }
  // Meta creates hello_world in every WABA; it is APPROVED and ready to send.
  if (![...waba.templates.values()].some((t) => t.name === 'hello_world')) {
    state.templateSeq += 1
    const id = String(900000000000000 + state.templateSeq)
    waba.templates.set(id, {
      id,
      name: 'hello_world',
      language: 'en_US',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Hello World' },
        {
          type: 'BODY',
          text: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.',
        },
        { type: 'FOOTER', text: 'WhatsApp Business Platform sample message' },
      ],
      quality_score: { score: 'UNKNOWN' },
    })
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
    sent: [],
    media: new Map(),
    delays: [],
    templateReview: { decision: 'APPROVED', delayMs: 400 },
    uploads: new Map(),
    templateSeq: 0,
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

async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; body: unknown }> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks)
  if ((req.headers['content-type'] ?? '').startsWith('multipart/')) return { raw, body: undefined }
  const text = raw.toString('utf8')
  if (!text) return { raw, body: undefined }
  try {
    return { raw, body: JSON.parse(text) }
  } catch {
    return { raw, body: text }
  }
}

/** Posts sent → delivered → read for a send, like Meta does, when a webhook target is set. */
function scheduleStatuses(state: MetaMockState, waba: Waba, sent: SentMessage): void {
  const target = state.webhookTarget
  if (!target) return
  const statuses = target.statuses ?? ['sent', 'delivered', 'read']
  const ids = { wabaId: waba.id, phoneNumberId: sent.phoneNumberId }
  // Meta prices template messages by the template's category; other messages are service.
  const t = sent.payload.template as { name?: string; language?: { code?: string } } | undefined
  const template = t
    ? [...waba.templates.values()].find((x) => x.name === t.name && x.language === t.language?.code)
    : undefined
  const pricing = t
    ? { billable: true, category: (template?.category ?? 'UTILITY').toLowerCase() }
    : { billable: false, category: 'service' }
  statuses.forEach((status, i) => {
    setTimeout(
      () =>
        void deliverWebhook(
          target.url,
          target.appSecret,
          statusWebhook(ids, {
            wamid: sent.wamid,
            status,
            recipientId: String(sent.payload.to),
            callbackData: sent.payload.biz_opaque_callback_data as string | undefined,
            pricing,
          }),
        ).catch(() => undefined),
      (target.delayMs ?? 300) * (i + 1),
    )
  })
}

/** Meta reviews a new or edited template, then posts `message_template_status_update`. */
function scheduleReview(state: MetaMockState, waba: Waba, t: MockTemplate): void {
  const review = state.templateReview
  if (review.decision === 'NONE') return
  setTimeout(() => {
    t.status = review.decision
    if (review.decision === 'REJECTED') t.rejected_reason = review.reason ?? 'INVALID_FORMAT'
    const target = state.webhookTarget
    if (!target) return
    void deliverWebhook(
      target.url,
      target.appSecret,
      templateStatusWebhook(waba.id, {
        id: t.id,
        name: t.name,
        language: t.language,
        event: review.decision,
        reason: review.decision === 'REJECTED' ? t.rejected_reason : undefined,
      }),
    ).catch(() => undefined)
  }, review.delayMs ?? 400)
}

const findTemplate = (state: MetaMockState, id: string) => {
  for (const waba of state.wabas.values())
    if (waba.templates.has(id)) return { waba, template: waba.templates.get(id)! }
  return undefined
}

const grantedWaba = (token: string): string | undefined => {
  const m = /^mock-(?:token|dev):([^:]+)/.exec(token)
  return m?.[1]
}

export function createMetaMockHandler(state: MetaMockState) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const method = req.method ?? 'GET'
    const { raw, body } = await readBody(req)
    const origin = `http://${req.headers.host ?? 'localhost'}`

    // Media bytes (what Meta's short-lived media URLs serve); needs a bearer token.
    if (url.pathname.startsWith('/__media/')) {
      const item = state.media.get(url.pathname.slice('/__media/'.length))
      if (!req.headers.authorization) return graphError(res, 401, 190, 'Missing token')
      if (!item) return send(res, 404, { error: 'unknown media' })
      res.writeHead(200, { 'Content-Type': item.mimeType })
      res.end(item.bytes)
      return
    }

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
          state.sent = []
          state.delays = []
          state.media.clear()
          state.uploads.clear()
          state.templateReview = { decision: 'APPROVED', delayMs: 400 }
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
        case 'delay':
          state.delays.push({
            times: 1,
            ms: 1000,
            ...(input as object),
          } as MetaMockState['delays'][number])
          return send(res, 200, { ok: true })
        case 'media':
          state.media.set(String(input.id), {
            mimeType: String(input.mimeType ?? 'image/jpeg'),
            bytes: Buffer.from(String(input.base64 ?? ''), 'base64'),
          })
          return send(res, 200, { ok: true })
        case 'webhook-target':
          state.webhookTarget = input.url ? (input as unknown as WebhookTarget) : undefined
          return send(res, 200, { ok: true })
        case 'inbound': {
          // Simulates a customer writing to one of the mock's numbers.
          const target = state.webhookTarget
          const found = findPhone(state, String(input.phoneNumberId))
          if (!target || !found)
            return send(res, 409, { error: 'no webhook target or unknown phone' })
          const wamid = `wamid.in.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
          const status = await deliverWebhook(
            target.url,
            target.appSecret,
            inboundMessageWebhook(
              { wabaId: found.waba.id, phoneNumberId: found.phone.id },
              {
                from: String(input.from ?? '919876543210'),
                name: input.name ? String(input.name) : undefined,
                text: String(input.text ?? 'Hello from the simulator'),
                wamid,
              },
            ),
          )
          return send(res, 200, { wamid, webhookStatus: status })
        }
        case 'revoke':
          state.revoked.add(String(input.token))
          return send(res, 200, { ok: true })
        case 'template-review':
          state.templateReview = { decision: 'APPROVED', delayMs: 400, ...(input as object) }
          return send(res, 200, { ok: true })
        case 'templates': {
          // Inspect (GET-like) or seed templates of a WABA; e.g. one created outside Fenwira.
          const waba = state.wabas.get(String(input.wabaId))
          if (!waba) return send(res, 404, { error: 'unknown waba' })
          for (const t of (input.add ?? []) as MockTemplate[]) {
            state.templateSeq += 1
            const id = t.id ?? String(900000000000000 + state.templateSeq)
            waba.templates.set(id, { ...t, id })
          }
          return send(res, 200, { templates: [...waba.templates.values()] })
        }
        case 'template-event': {
          // Meta changes a template (approve/reject/pause/disable, quality, category) and tells us.
          const found = findTemplate(state, String(input.id))
          const target = state.webhookTarget
          if (!found || !target) return send(res, 409, { error: 'unknown template or no target' })
          const { waba, template } = found
          let payload: unknown
          if (input.quality) {
            template.quality_score = { score: String(input.quality) }
            payload = wabaFieldWebhook(waba.id, 'message_template_quality_update', {
              message_template_id: Number(template.id),
              message_template_name: template.name,
              message_template_language: template.language,
              new_quality_score: String(input.quality),
            })
          } else if (input.category) {
            const previous = template.category
            template.category = String(input.category)
            payload = wabaFieldWebhook(waba.id, 'template_category_update', {
              message_template_id: Number(template.id),
              message_template_name: template.name,
              message_template_language: template.language,
              previous_category: previous,
              new_category: template.category,
            })
          } else {
            template.status = String(input.event)
            if (input.reason) template.rejected_reason = String(input.reason)
            payload = templateStatusWebhook(waba.id, {
              id: template.id,
              name: template.name,
              language: template.language,
              event: String(input.event),
              reason: input.reason ? String(input.reason) : undefined,
            })
          }
          const status = await deliverWebhook(target.url, target.appSecret, payload)
          return send(res, 200, { webhookStatus: status })
        }
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

    const delay = state.delays.find((d) => path.includes(d.pathContains))
    if (delay) {
      delay.times -= 1
      if (delay.times <= 0) state.delays.splice(state.delays.indexOf(delay), 1)
      await new Promise((r) => setTimeout(r, delay.ms))
    }
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

    const token = authorization?.replace(/^(Bearer|OAuth)\s+/i, '')
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

    // Resumable upload (template header samples): session, then the bytes → handle.
    if (second === 'uploads' && method === 'POST') {
      const id = `upload:${Date.now()}${Math.random().toString(36).slice(2, 8)}`
      state.uploads.set(id, {
        bytes: Buffer.alloc(0),
        mimeType: url.searchParams.get('file_type') ?? 'application/octet-stream',
      })
      return send(res, 200, { id })
    }
    if (first?.startsWith('upload:') && !second && method === 'POST') {
      const upload = state.uploads.get(first)
      if (!upload) return graphError(res, 400, 100, 'Invalid upload session')
      if (!/^OAuth /.test(authorization ?? ''))
        return graphError(res, 401, 190, 'Uploads authenticate with OAuth')
      upload.bytes = raw
      return send(res, 200, { h: `4::${Buffer.from(first).toString('base64url')}` })
    }

    // Edit an existing template (Meta re-reviews it).
    const existing = first && !second ? findTemplate(state, first) : undefined
    if (existing && method === 'POST') {
      if (existing.waba.id !== granted) return graphError(res, 403, 200, 'Permissions error')
      const payload = (body ?? {}) as Record<string, unknown>
      if (payload.components) existing.template.components = payload.components as never
      if (payload.category) existing.template.category = String(payload.category)
      existing.template.status = 'PENDING'
      scheduleReview(state, existing.waba, existing.template)
      return send(res, 200, { success: true })
    }
    if (first && !second && method === 'GET' && state.media.has(first)) {
      const item = state.media.get(first)!
      return send(res, 200, {
        id: first,
        url: `${origin}/__media/${first}`,
        mime_type: item.mimeType,
        file_size: item.bytes.length,
      })
    }
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
      if (second === 'message_templates' && method === 'GET') {
        const all = [...waba.templates.values()]
        const limit = Number(url.searchParams.get('limit') ?? 100)
        const start = Number(url.searchParams.get('after') ?? 0)
        const page = all.slice(start, start + limit)
        const next = start + limit < all.length
        return send(res, 200, {
          data: page,
          paging: { cursors: { after: String(start + limit) }, ...(next ? { next: 'more' } : {}) },
        })
      }
      if (second === 'message_templates' && method === 'POST') {
        const p = (body ?? {}) as Record<string, unknown>
        const name = String(p.name ?? '')
        const language = String(p.language ?? '')
        if (!/^[a-z0-9_]+$/.test(name)) return graphError(res, 400, 100, 'Invalid parameter')
        if ([...waba.templates.values()].some((t) => t.name === name && t.language === language))
          return send(res, 400, {
            error: {
              message: 'Invalid parameter',
              type: 'OAuthException',
              code: 100,
              error_subcode: 2388024,
              error_user_msg: `Content in this language already exists for ${name}.`,
            },
          })
        state.templateSeq += 1
        const id = String(900000000000000 + state.templateSeq)
        const t: MockTemplate = {
          id,
          name,
          language,
          category: String(p.category ?? 'UTILITY'),
          status: 'PENDING',
          components: (p.components ?? []) as MockTemplate['components'],
        }
        waba.templates.set(id, t)
        scheduleReview(state, waba, t)
        return send(res, 200, { id, status: 'PENDING', category: t.category })
      }
      if (second === 'message_templates' && method === 'DELETE') {
        const name = url.searchParams.get('name')
        let removed = 0
        for (const [id, t] of waba.templates)
          if (t.name === name) removed += Number(waba.templates.delete(id))
        if (!removed) return graphError(res, 404, 100, 'Template not found')
        return send(res, 200, { success: true })
      }
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
        const payload = (body ?? {}) as Record<string, unknown>
        if (payload.status === 'read') return send(res, 200, { success: true })
        const type = String(payload.type ?? '')
        if (type === 'template') {
          const t = payload.template as { name?: string; language?: { code?: string } }
          const match = [...phone.waba.templates.values()].find(
            (x) => x.name === t?.name && x.language === t?.language?.code,
          )
          if (!match)
            return graphError(res, 404, 132001, 'Template name does not exist in the translation')
          if (match.status === 'PAUSED') return graphError(res, 400, 132015, 'Template is paused')
          if (match.status !== 'APPROVED')
            return graphError(res, 400, 132016, 'Template is disabled')
        }
        const media = payload[type] as { id?: string } | undefined
        if (
          ['image', 'document', 'audio', 'video'].includes(type) &&
          !state.media.has(media?.id ?? '')
        )
          return graphError(res, 400, 131053, 'Media upload error')
        const wamid = `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
        const sent = { phoneNumberId: phone.phone.id, wamid, payload }
        state.sent.push(sent)
        scheduleStatuses(state, phone.waba, sent)
        return send(res, 200, {
          messaging_product: 'whatsapp',
          contacts: [{ input: payload.to, wa_id: payload.to }],
          messages: [{ id: wamid }],
        })
      }
      if (second === 'media' && method === 'POST') {
        const type =
          /name="type"\r\n\r\n([^\r]+)/.exec(raw.toString('latin1'))?.[1] ??
          'application/octet-stream'
        const id = `media${state.media.size + 1}${Date.now()}`
        state.media.set(id, { mimeType: type, bytes: raw })
        return send(res, 200, { id })
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
