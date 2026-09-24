import { type MessageContent, type MessageType } from '@fenwira/contracts'
import { createHash } from 'node:crypto'

/**
 * Meta webhook payload → typed events (docs/MESSAGING_ENGINE.md → Inbound pipeline). Unknown
 * shapes are dropped here rather than failing the request: Meta would otherwise retry forever.
 */
export type InboundMessage = {
  providerMessageId: string
  /** Sender's WhatsApp id (digits, no "+"). */
  from: string
  profileName?: string
  timestamp: string
  type: MessageType
  content: MessageContent
  replyToProviderMessageId?: string
}

export type StatusUpdate = {
  providerMessageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipientId?: string
  error?: { code: number; title: string; detail?: string }
  pricing?: Record<string, unknown>
  /** Our value from the send (`biz_opaque_callback_data`): the Fenwira message id. */
  callbackData?: string
}

export type WabaEventKind =
  'TEMPLATE_STATUS' | 'TEMPLATE_QUALITY' | 'TEMPLATE_CATEGORY' | 'PHONE_QUALITY' | 'ACCOUNT_UPDATE'

export type NormalizedWebhookEvent =
  | {
      kind: 'MESSAGE'
      dedupeKey: string
      wabaId: string
      phoneNumberId: string
      message: InboundMessage
    }
  | {
      kind: 'STATUS'
      dedupeKey: string
      wabaId: string
      phoneNumberId: string
      status: StatusUpdate
    }
  | {
      kind: WabaEventKind
      dedupeKey: string
      wabaId: string
      phoneNumberId: null
      data: Record<string, unknown>
    }

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const iso = (unixSeconds: unknown): string => {
  const n = Number(unixSeconds)
  return new Date(Number.isFinite(n) && n > 0 ? n * 1000 : Date.now()).toISOString()
}

const WABA_FIELDS: Record<string, WabaEventKind> = {
  message_template_status_update: 'TEMPLATE_STATUS',
  message_template_quality_update: 'TEMPLATE_QUALITY',
  template_category_update: 'TEMPLATE_CATEGORY',
  phone_number_quality_update: 'PHONE_QUALITY',
  account_update: 'ACCOUNT_UPDATE',
}
const MEDIA: Record<string, MessageType> = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
  sticker: 'STICKER',
}
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])

export function normalizeWebhook(payload: unknown): NormalizedWebhookEvent[] {
  const root = obj(payload)
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return []
  const events: NormalizedWebhookEvent[] = []
  for (const entryRaw of root.entry) {
    const entry = obj(entryRaw)
    const wabaId = str(entry.id)
    if (!wabaId || !Array.isArray(entry.changes)) continue
    for (const changeRaw of entry.changes) {
      const change = obj(changeRaw)
      const field = str(change.field)
      const value = obj(change.value)
      if (field === 'messages') events.push(...messagesChange(wabaId, value))
      else if (field && WABA_FIELDS[field]) {
        const stamp = str(value.timestamp) ?? (entry.time ? String(entry.time) : '')
        const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
        events.push({
          kind: WABA_FIELDS[field],
          dedupeKey: `${field}:${wabaId}:${stamp || hash}:${hash}`,
          wabaId,
          phoneNumberId: null,
          data: value,
        })
      }
    }
  }
  return events
}

function messagesChange(wabaId: string, value: Obj): NormalizedWebhookEvent[] {
  const phoneNumberId = str(obj(value.metadata).phone_number_id)
  if (!phoneNumberId) return []
  const profiles = new Map<string, string>()
  for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
    const waId = str(obj(c).wa_id)
    const name = str(obj(obj(c).profile).name)
    if (waId && name) profiles.set(waId, name)
  }
  const out: NormalizedWebhookEvent[] = []
  for (const m of Array.isArray(value.messages) ? value.messages : []) {
    const message = inboundMessage(obj(m), profiles)
    if (message)
      out.push({
        kind: 'MESSAGE',
        dedupeKey: `msg:${message.providerMessageId}`,
        wabaId,
        phoneNumberId,
        message,
      })
  }
  for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
    const status = statusUpdate(obj(s))
    if (status)
      out.push({
        kind: 'STATUS',
        dedupeKey: `st:${status.providerMessageId}:${status.status}${status.error ? `:${status.error.code}` : ''}`,
        wabaId,
        phoneNumberId,
        status,
      })
  }
  return out
}

function inboundMessage(m: Obj, profiles: Map<string, string>): InboundMessage | null {
  const id = str(m.id)
  const from = str(m.from)
  const metaType = str(m.type)
  if (!id || !from || !metaType) return null
  const { type, content } = contentOf(metaType, m)
  return {
    providerMessageId: id,
    from,
    profileName: profiles.get(from),
    timestamp: iso(m.timestamp),
    type,
    content,
    replyToProviderMessageId: str(obj(m.context).id),
  }
}

function contentOf(metaType: string, m: Obj): { type: MessageType; content: MessageContent } {
  const body = obj(m[metaType])
  if (metaType === 'text')
    return { type: 'TEXT', content: { type: 'TEXT', text: str(body.body) ?? '' } }
  const media = MEDIA[metaType]
  if (media)
    return {
      type: media,
      content: {
        type: media,
        mediaId: str(body.id),
        mimeType: str(body.mime_type),
        caption: str(body.caption),
        filename: str(body.filename),
      } as MessageContent,
    }
  if (metaType === 'location')
    return {
      type: 'LOCATION',
      content: {
        type: 'LOCATION',
        latitude: Number(body.latitude),
        longitude: Number(body.longitude),
        name: str(body.name),
        address: str(body.address),
      },
    }
  if (metaType === 'contacts')
    return {
      type: 'CONTACTS',
      content: { type: 'CONTACTS', contacts: Array.isArray(m.contacts) ? m.contacts : [] },
    }
  if (metaType === 'interactive') {
    const reply = obj(body.button_reply ?? body.list_reply ?? body.nfm_reply)
    return {
      type: 'INTERACTIVE',
      content: {
        type: 'INTERACTIVE',
        text: str(reply.title),
        replyId: str(reply.id),
        interactive: body,
      },
    }
  }
  if (metaType === 'button')
    // Quick-reply tap on a template button.
    return {
      type: 'INTERACTIVE',
      content: { type: 'INTERACTIVE', text: str(body.text), replyId: str(body.payload) },
    }
  if (metaType === 'reaction')
    return {
      type: 'REACTION',
      content: {
        type: 'REACTION',
        emoji: str(body.emoji) ?? '',
        providerMessageId: str(body.message_id) ?? '',
      },
    }
  return { type: 'UNSUPPORTED', content: { type: 'UNSUPPORTED', metaType } }
}

function statusUpdate(s: Obj): StatusUpdate | null {
  const id = str(s.id)
  const status = str(s.status)
  if (!id || !status || !STATUSES.has(status)) return null
  const err = obj(Array.isArray(s.errors) ? s.errors[0] : undefined)
  return {
    providerMessageId: id,
    status: status as StatusUpdate['status'],
    timestamp: iso(s.timestamp),
    recipientId: str(s.recipient_id),
    callbackData: str(s.biz_opaque_callback_data),
    ...(err.code !== undefined
      ? {
          error: {
            code: Number(err.code),
            title: str(err.title) ?? 'Failed',
            detail: str(obj(err.error_data).details) ?? str(err.message),
          },
        }
      : {}),
    ...(s.pricing ? { pricing: obj(s.pricing) } : {}),
  }
}
