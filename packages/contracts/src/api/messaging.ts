import { z } from 'zod'
import { idSchema } from './common'

/**
 * Message content, typed per message type (docs/MESSAGING_ENGINE.md). Stored as `messages.content`
 * and shared by the API, workers and web. Outbound sends in v1 accept TEXT, media (a READY file),
 * and TEMPLATE; inbound can be any type.
 */
export const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'DOCUMENT',
  'AUDIO',
  'VIDEO',
  'STICKER',
  'LOCATION',
  'CONTACTS',
  'TEMPLATE',
  'INTERACTIVE',
  'REACTION',
  'SYSTEM_EVENT',
  'UNSUPPORTED',
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]
export const MEDIA_TYPES = ['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

const mediaFields = {
  /** Our stored copy (files.id); set once downloaded (inbound) or when sending. */
  fileId: idSchema.optional(),
  /** Meta's media id (inbound, or after upload for a send). */
  mediaId: z.string().optional(),
  mimeType: z.string().optional(),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(240).optional(),
}

export const messageContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z.string().min(1).max(4096),
    previewUrl: z.boolean().optional(),
  }),
  z.object({ type: z.literal('IMAGE'), ...mediaFields }),
  z.object({ type: z.literal('DOCUMENT'), ...mediaFields }),
  z.object({ type: z.literal('AUDIO'), ...mediaFields }),
  z.object({ type: z.literal('VIDEO'), ...mediaFields }),
  z.object({ type: z.literal('STICKER'), ...mediaFields }),
  z.object({
    type: z.literal('LOCATION'),
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  z.object({ type: z.literal('CONTACTS'), contacts: z.array(z.unknown()) }),
  z.object({
    type: z.literal('TEMPLATE'),
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(15),
    components: z.array(z.unknown()).optional(),
  }),
  /** Inbound button/list replies: `text` is what the customer tapped. */
  z.object({
    type: z.literal('INTERACTIVE'),
    text: z.string().optional(),
    replyId: z.string().optional(),
    interactive: z.unknown().optional(),
  }),
  z.object({ type: z.literal('REACTION'), emoji: z.string(), providerMessageId: z.string() }),
  z.object({ type: z.literal('SYSTEM_EVENT'), event: z.string(), data: z.unknown().optional() }),
  z.object({ type: z.literal('UNSUPPORTED'), metaType: z.string().optional() }),
])
export type MessageContent = z.infer<typeof messageContentSchema>

/** What callers may send in Phase 5. Media must reference a READY file we store. */
export const sendableContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z.string().trim().min(1).max(4096),
    previewUrl: z.boolean().optional(),
  }),
  z.object({
    type: z.enum(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO']),
    fileId: idSchema,
    caption: z.string().max(1024).optional(),
    filename: z.string().max(240).optional(),
  }),
  z.object({
    type: z.literal('TEMPLATE'),
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/),
    language: z.string().min(2).max(15),
    components: z.array(z.unknown()).max(20).optional(),
  }),
])
export type SendableContent = z.infer<typeof sendableContentSchema>

export const MESSAGE_STATUSES = [
  'RECEIVED',
  'CREATED',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]
export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'SYSTEM'] as const
export const MESSAGE_SOURCES = [
  'CUSTOMER',
  'INBOX',
  'CAMPAIGN',
  'AUTOMATION',
  'SYSTEM',
  'API',
] as const
export type MessageSource = (typeof MESSAGE_SOURCES)[number]

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  contactId: idSchema,
  direction: z.enum(MESSAGE_DIRECTIONS),
  type: z.enum(MESSAGE_TYPES),
  status: z.enum(MESSAGE_STATUSES),
  source: z.enum(MESSAGE_SOURCES),
  content: messageContentSchema,
  providerMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  sentByUserId: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  providerTimestamp: z.string().nullable(),
  createdAt: z.string(),
})
export type Message = z.infer<typeof messageSchema>

export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'SNOOZED', 'RESOLVED'] as const
export const conversationSchema = z.object({
  id: idSchema,
  status: z.enum(CONVERSATION_STATUSES),
  contact: z.object({
    id: idSchema,
    phoneE164: z.string(),
    name: z.string().nullable(),
    waProfileName: z.string().nullable(),
  }),
  phoneNumber: z.object({ id: idSchema, displayPhoneNumber: z.string() }),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastCustomerMessageAt: z.string().nullable(),
  serviceWindowExpiresAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const sendMessageRequestSchema = z.object({ content: sendableContentSchema })
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>

/** New outbound conversation to a phone number (creates the contact if needed). */
export const startConversationRequestSchema = z.object({
  to: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ''))
    .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter the number in international format.')),
  phoneNumberId: idSchema.optional(),
  content: sendableContentSchema,
})
export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>

export const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().max(200).optional(),
})

// Files (message media) -------------------------------------------------------------------------
export const FILE_PURPOSES = [
  'MESSAGE_MEDIA',
  'IMPORT',
  'EXPORT',
  'AVATAR',
  'TEMPLATE_SAMPLE',
] as const
/** Meta's limits per media type (bytes). */
export const MEDIA_LIMITS: Record<
  'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO',
  { mime: RegExp; max: number }
> = {
  IMAGE: { mime: /^image\/(jpeg|png)$/, max: 5 * 1024 * 1024 },
  DOCUMENT: {
    mime: /^(application\/(pdf|msword|vnd\..+)|text\/plain)$/,
    max: 100 * 1024 * 1024,
  },
  AUDIO: { mime: /^audio\/(aac|mp4|mpeg|amr|ogg)$/, max: 16 * 1024 * 1024 },
  VIDEO: { mime: /^video\/(mp4|3gpp)$/, max: 16 * 1024 * 1024 },
}

export const uploadUrlRequestSchema = z.object({
  purpose: z.literal('MESSAGE_MEDIA'),
  mimeType: z.string().min(3).max(127),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024),
  filename: z.string().max(240).optional(),
})
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>
export const uploadUrlResponseSchema = z.object({
  fileId: idSchema,
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
})
export const fileSchema = z.object({
  id: idSchema,
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(['PENDING_UPLOAD', 'READY', 'REJECTED']),
  createdAt: z.string(),
})
export type FileDto = z.infer<typeof fileSchema>
