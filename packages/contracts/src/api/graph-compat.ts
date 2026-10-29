import { z } from 'zod'

/**
 * Meta-compatible send (docs/API_KEYS.md → Meta-compatible send): the Cloud API body a client
 * already builds for `POST /{phone-number-id}/messages`, accepted as-is under `/api/v1/graph` so
 * switching an existing integration to Fenwira is a base URL and token change. Only `template`
 * and `text` messages; Meta's `type` defaults to `text`.
 */
export const graphSendRequestSchema = z
  .object({
    messaging_product: z.literal('whatsapp').optional(),
    recipient_type: z.literal('individual').optional(),
    to: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s()+-]/g, ''))
      .pipe(z.string().regex(/^[1-9]\d{7,14}$/, 'Send the number with its country code.')),
    type: z.enum(['template', 'text']).default('text'),
    text: z
      .object({
        body: z.string().trim().min(1).max(4096),
        preview_url: z.boolean().optional(),
      })
      .optional(),
    template: z
      .object({
        name: z
          .string()
          .min(1)
          .max(512)
          .regex(/^[a-z0-9_]+$/),
        language: z.object({ code: z.string().min(2).max(15) }),
        components: z.array(z.unknown()).max(20).optional(),
      })
      .optional(),
  })
  .refine((b) => (b.type === 'template' ? Boolean(b.template) : Boolean(b.text)), {
    message: 'Send a `template` object for type template, or a `text` object for type text.',
    path: ['type'],
  })
export type GraphSendRequest = z.infer<typeof graphSendRequestSchema>

export const graphSendResponseSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  contacts: z.array(z.object({ input: z.string(), wa_id: z.string() })),
  /** `id` is the Fenwira message id (GET /messages/{id}), not a wamid: the send is queued. */
  messages: z.array(z.object({ id: z.string(), message_status: z.literal('accepted') })),
})
export type GraphSendResponse = z.infer<typeof graphSendResponseSchema>

/** The `/{phone-number-id}/media` upload result: a Fenwira file id, usable as a media `id`. */
export const graphMediaResponseSchema = z.object({ id: z.string() })

export const graphPhoneResponseSchema = z.object({
  id: z.string(),
  display_phone_number: z.string(),
  verified_name: z.string(),
})
