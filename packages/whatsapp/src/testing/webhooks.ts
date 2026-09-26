import { signWebhookBody } from '../signature'

/**
 * Builders for Meta webhook payloads (the exact envelope Meta posts), for tests and the mock's
 * webhook delivery. Pair with `signWebhookBody` for the X-Hub-Signature-256 header.
 */
type Ids = { wabaId: string; phoneNumberId: string; displayPhoneNumber?: string }

export function messagesEnvelope(ids: Ids, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: ids.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: ids.displayPhoneNumber ?? '15550100001',
                phone_number_id: ids.phoneNumberId,
              },
              ...value,
            },
          },
        ],
      },
    ],
  }
}

export function inboundMessageWebhook(
  ids: Ids,
  msg: {
    from: string
    wamid: string
    name?: string
    timestamp?: number
    /** Meta message object minus from/id/timestamp, e.g. { type: 'text', text: { body } }. */
    body?: Record<string, unknown>
    text?: string
  },
) {
  const body = msg.body ?? { type: 'text', text: { body: msg.text ?? 'Hello' } }
  return messagesEnvelope(ids, {
    contacts: [{ profile: { name: msg.name ?? 'Test Customer' }, wa_id: msg.from }],
    messages: [
      {
        from: msg.from,
        id: msg.wamid,
        timestamp: String(msg.timestamp ?? Math.floor(Date.now() / 1000)),
        ...body,
      },
    ],
  })
}

export function statusWebhook(
  ids: Ids,
  s: {
    wamid: string
    status: 'sent' | 'delivered' | 'read' | 'failed'
    recipientId?: string
    timestamp?: number
    errorCode?: number
    callbackData?: string
  },
) {
  return messagesEnvelope(ids, {
    statuses: [
      {
        id: s.wamid,
        status: s.status,
        timestamp: String(s.timestamp ?? Math.floor(Date.now() / 1000)),
        recipient_id: s.recipientId ?? '15550100002',
        ...(s.callbackData ? { biz_opaque_callback_data: s.callbackData } : {}),
        ...(s.status !== 'failed'
          ? {
              pricing: { billable: true, pricing_model: 'PMP', category: 'utility' },
            }
          : {
              errors: [
                { code: s.errorCode ?? 131026, title: 'Message undeliverable', message: 'x' },
              ],
            }),
      },
    ],
  })
}

/** A WABA-level change (template status/quality/category) with Meta's envelope. */
export function wabaFieldWebhook(wabaId: string, field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: wabaId, time: Math.floor(Date.now() / 1000), changes: [{ field, value }] }],
  }
}

export function templateStatusWebhook(
  wabaId: string,
  t: { id: string; name: string; language: string; event: string; reason?: string },
) {
  return wabaFieldWebhook(wabaId, 'message_template_status_update', {
    event: t.event,
    message_template_id: Number(t.id),
    message_template_name: t.name,
    message_template_language: t.language,
    reason: t.reason ?? 'NONE',
  })
}

/** POSTs a signed webhook like Meta does. Returns the HTTP status. */
export async function deliverWebhook(
  url: string,
  appSecret: string,
  payload: unknown,
): Promise<number> {
  const raw = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signWebhookBody(appSecret, raw),
    },
    body: raw,
  })
  return res.status
}
