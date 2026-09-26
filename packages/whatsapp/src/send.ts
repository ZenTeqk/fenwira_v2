import { type SendableContent } from '@fenwira/contracts'
import { type GraphClientOptions, GraphHttp } from './http'
import { MEDIA_PLACEHOLDER } from './template-payload'

/**
 * The only functions that deliver anything to a WhatsApp user. `@fenwira/whatsapp/send` may be
 * imported by the outbound worker alone (dependency-cruiser rule `meta-send-only-in-outbound`);
 * everything else goes through MessagingService → outbox → whatsapp.outbound.
 */
export type OutboundPayload = Record<string, unknown>

/** Graph `messages` body for our content. Media must already be uploaded (`mediaId`). */
export function buildSendPayload(
  to: string,
  content: SendableContent,
  mediaId?: string,
  /** Echoed back by Meta in status webhooks; lets us match a send whose response we lost. */
  callbackData?: string,
): OutboundPayload {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...(callbackData ? { biz_opaque_callback_data: callbackData.slice(0, 512) } : {}),
  }
  switch (content.type) {
    case 'TEXT':
      return {
        ...base,
        type: 'text',
        text: { body: content.text, preview_url: !!content.previewUrl },
      }
    case 'TEMPLATE': {
      // A media header's parameter carries MEDIA_PLACEHOLDER until the file is uploaded.
      const components = mediaId
        ? JSON.parse(
            JSON.stringify(content.components ?? []).replaceAll(MEDIA_PLACEHOLDER, mediaId),
          )
        : content.components
      return {
        ...base,
        type: 'template',
        template: {
          name: content.name,
          language: { code: content.language },
          ...(components?.length ? { components } : {}),
        },
      }
    }
    default: {
      if (!mediaId) throw new Error(`${content.type} send needs an uploaded media id`)
      const type = content.type.toLowerCase()
      const media: Record<string, unknown> = { id: mediaId }
      if (content.caption && type !== 'audio') media.caption = content.caption
      if (content.filename && type === 'document') media.filename = content.filename
      return { ...base, type, [type]: media }
    }
  }
}

export class MessageSender {
  private readonly http: GraphHttp

  constructor(options: GraphClientOptions) {
    this.http = new GraphHttp(options)
  }

  async sendMessage(
    token: string,
    phoneNumberId: string,
    payload: OutboundPayload,
  ): Promise<{ providerMessageId: string }> {
    const body = await this.http.request<{ messages?: Array<{ id: string }> }>(
      'POST',
      `${phoneNumberId}/messages`,
      token,
      { json: payload },
    )
    const id = body.messages?.[0]?.id
    if (!id) throw new Error('Meta accepted the send but returned no message id')
    return { providerMessageId: id }
  }

  /** Uploads bytes for a media send; returns Meta's media id. */
  async uploadMedia(
    token: string,
    phoneNumberId: string,
    media: { bytes: Buffer; mimeType: string; filename: string },
  ): Promise<string> {
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', media.mimeType)
    form.set(
      'file',
      new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
      media.filename,
    )
    const body = await this.http.request<{ id: string }>('POST', `${phoneNumberId}/media`, token, {
      form,
    })
    return body.id
  }

  /** Blue ticks for an inbound message. */
  async markRead(token: string, phoneNumberId: string, providerMessageId: string): Promise<void> {
    await this.http.request('POST', `${phoneNumberId}/messages`, token, {
      json: { messaging_product: 'whatsapp', status: 'read', message_id: providerMessageId },
    })
  }
}
