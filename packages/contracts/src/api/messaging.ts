import { z } from 'zod'
import { templateVariablesSchema } from '../templates/components'
import { messageTemplateSnapshotSchema, type MessageTemplateSnapshot } from '../templates/snapshot'
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
    /** Meta send components (parameters), built from the variables. */
    components: z.array(z.unknown()).optional(),
    /** Managed template (Phase 8): what was sent, for display and the send-time checks. */
    templateId: z.string().optional(),
    templateVersionId: z.string().optional(),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
    variables: z.unknown().optional(),
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
  z
    .object({
      type: z.literal('INTERACTIVE'),
      text: z.string().trim().min(1).max(1024),
      presentation: z.enum(['BUTTONS', 'LIST', 'CTA']),
      options: z
        .array(z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(20) }))
        .min(1)
        .max(10),
      url: z
        .url()
        .refine((v) => v.startsWith('https://'))
        .optional(),
    })
    .refine((c) => c.presentation !== 'BUTTONS' || c.options.length <= 3, 'At most three buttons.')
    .refine((c) => c.presentation !== 'CTA' || !!c.url, 'Enter a link address.'),
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
  /**
   * A template send (docs/TEMPLATE_ENGINE.md → Rendering and sending): either an APPROVED
   * version with positional variables, or a template name + language that resolves to an
   * APPROVED template of the sending number's WABA (raw Meta `components` allowed).
   */
  z
    .object({
      type: z.literal('TEMPLATE'),
      templateVersionId: idSchema.optional(),
      variables: templateVariablesSchema.optional(),
      name: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/)
        .optional(),
      language: z.string().min(2).max(15).optional(),
      components: z.array(z.unknown()).max(20).optional(),
    })
    .refine((t) => Boolean(t.templateVersionId) !== Boolean(t.name && t.language), {
      message: 'Send either templateVersionId (with variables) or name and language.',
      path: ['templateVersionId'],
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
  /** Sent by the AI Assistant (shown as an "AI" label). */
  aiGenerated: z.boolean().default(false),
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
  /** TEMPLATE messages: what the customer saw (docs/MESSAGING_ENGINE.md → Template snapshot). */
  templateSnapshot: messageTemplateSnapshotSchema.nullable(),
  /** The attached file (media, or a template's media header), when the thread loads it. */
  media: z
    .object({
      fileId: idSchema,
      filename: z.string().nullable(),
      mimeType: z.string(),
      sizeBytes: z.number(),
    })
    .nullable()
    .optional(),
})
export type Message = z.infer<typeof messageSchema>

/**
 * Thread media filter (docs/INBOX.md → Media filter): images, videos and documents, including
 * template messages with a media header. Stickers and audio are not media here (yet).
 */
export const THREAD_MEDIA_FILTERS = ['image', 'video', 'document'] as const
export type ThreadMediaFilter = (typeof THREAD_MEDIA_FILTERS)[number]
export type ThreadMediaKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT'
export const MEDIA_FILTER_KIND: Record<ThreadMediaFilter, ThreadMediaKind> = {
  image: 'IMAGE',
  video: 'VIDEO',
  document: 'DOCUMENT',
}
/** Same rule as the `messages.media_type` generated column (post-migrate.sql). */
export function mediaKindOf(m: {
  type: MessageType
  templateSnapshot?: MessageTemplateSnapshot | null
}): ThreadMediaKind | null {
  if (m.type === 'IMAGE' || m.type === 'VIDEO' || m.type === 'DOCUMENT') return m.type
  if (m.type !== 'TEMPLATE') return null
  const header = m.templateSnapshot?.header
  return header && header.type !== 'TEXT' ? header.type : null
}
/** Thread filters on the message's own type (no media header rule): voice notes and templates. */
export const THREAD_TYPE_FILTERS = ['audio', 'template'] as const
export type ThreadTypeFilter = (typeof THREAD_TYPE_FILTERS)[number]
export const TYPE_FILTER_TYPE: Record<ThreadTypeFilter, 'AUDIO' | 'TEMPLATE'> = {
  audio: 'AUDIO',
  template: 'TEMPLATE',
}
export const mediaCountsSchema = z.object({
  /** Every customer and workspace message (system events excluded). */
  all: z.number().int(),
  image: z.number().int(),
  video: z.number().int(),
  document: z.number().int(),
  audio: z.number().int(),
  template: z.number().int(),
})
export type MediaCounts = z.infer<typeof mediaCountsSchema>

export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'SNOOZED', 'RESOLVED'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]
export const AUTOMATION_STATES = [
  'AUTOMATION_ACTIVE',
  'AGENT_TAKEOVER',
  'AUTOMATION_PAUSED',
] as const
export type AutomationState = (typeof AUTOMATION_STATES)[number]

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
  assignee: z.object({ id: idSchema, name: z.string() }).nullable(),
  tags: z.array(z.object({ id: idSchema, name: z.string(), color: z.string() })),
  automationState: z.enum(AUTOMATION_STATES),
  /** An AI Assistant conversation is in progress (detail view only; docs/AI_ASSISTANT.md). */
  aiHandling: z.boolean().optional(),
  /** Unread messages for the current user. */
  unreadCount: z.number().int(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastCustomerMessageAt: z.string().nullable(),
  serviceWindowExpiresAt: z.string().nullable(),
  /** The server's view of the 24-hour window; the UI counts down from expiresAt. */
  serviceWindow: z.object({ expiresAt: z.string().nullable(), isOpen: z.boolean() }),
  snoozedUntil: z.string().nullable(),
  firstResponseAt: z.string().nullable(),
  /** Matching message text when the list was searched. */
  snippet: z.string().nullable().optional(),
  createdAt: z.string(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const INBOX_VIEWS = ['mine', 'unassigned', 'all', 'takeover', 'resolved'] as const
export type InboxView = (typeof INBOX_VIEWS)[number]
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true')
export const conversationsQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  assigneeId: idSchema.optional(),
  unassigned: boolParam.optional(),
  tagId: idSchema.optional(),
  unread: boolParam.optional(),
  window: z.enum(['OPEN', 'CLOSED']).optional(),
  phoneNumberId: idSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(['recent', 'oldest_waiting']).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
})
export type ConversationsQuery = z.infer<typeof conversationsQuerySchema>

/** Tab counts within the list's active search, status and unread filters (docs/INBOX.md). */
export const conversationCountsQuerySchema = conversationsQuerySchema.pick({
  status: true,
  unread: true,
  q: true,
})
export type ConversationCountsQuery = z.infer<typeof conversationCountsQuerySchema>
export const conversationCountsSchema = z.object({
  all: z.number().int(),
  mine: z.number().int(),
  unassigned: z.number().int(),
})
export type ConversationCounts = z.infer<typeof conversationCountsSchema>

export const assignRequestSchema = z.object({ assigneeId: idSchema.nullable() })
export const conversationStatusRequestSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES),
    snoozedUntil: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => (v.status === 'SNOOZED') === Boolean(v.snoozedUntil), {
    path: ['snoozedUntil'],
    message: 'Snoozing needs a time (and only snoozing does).',
  })
export const automationStateRequestSchema = z.object({ state: z.enum(AUTOMATION_STATES) })
export const composeLockRequestSchema = z.object({ force: z.boolean().default(false) })
export const composeLockSchema = z.object({
  conversationId: idSchema,
  holder: z.object({ id: idSchema, name: z.string() }).nullable(),
  expiresAt: z.string().nullable(),
})
export type ComposeLock = z.infer<typeof composeLockSchema>

export const conversationNoteSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  body: z.string(),
  authorId: idSchema,
  authorName: z.string(),
  mentions: z.array(idSchema),
  createdAt: z.string(),
})
export type ConversationNote = z.infer<typeof conversationNoteSchema>
export const createConversationNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentions: z.array(idSchema).max(20).default([]),
})

export const PRESENCE_STATUSES = ['ONLINE', 'AWAY', 'OFFLINE'] as const
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]
export const presenceSchema = z.object({
  userId: idSchema,
  name: z.string(),
  status: z.enum(PRESENCE_STATUSES),
  lastSeen: z.string().nullable(),
})
export type Presence = z.infer<typeof presenceSchema>

export const notificationSchema = z.object({
  id: idSchema,
  type: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Notification = z.infer<typeof notificationSchema>

export const inboxSettingsSchema = z.object({
  autoAssign: z.enum(['OFF', 'ROUND_ROBIN']),
  inboxVisibility: z.enum(['ALL', 'ASSIGNED_ONLY']),
  takeoverAutoReleaseHours: z.number().int().min(1).max(720).nullable(),
})
export type InboxSettings = z.infer<typeof inboxSettingsSchema>

/** Workspace-shared canned replies (docs/INBOX.md → Canned replies, decisions I2/I3). */
export const cannedReplyShortcutSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^\/[a-z0-9_-]{1,32}$/, 'Use / followed by up to 32 letters, digits, - or _')
export const cannedReplySchema = z.object({
  id: idSchema,
  shortcut: z.string(),
  title: z.string(),
  body: z.string(),
  createdBy: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CannedReply = z.infer<typeof cannedReplySchema>
export const createCannedReplySchema = z.object({
  shortcut: cannedReplyShortcutSchema,
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4096),
})
export type CreateCannedReply = z.infer<typeof createCannedReplySchema>
export const updateCannedReplySchema = createCannedReplySchema.partial()
export const cannedRepliesQuerySchema = z.object({ q: z.string().trim().max(80).optional() })

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
  /** Only this kind of media (counts: GET /conversations/:id/media-counts). */
  type: z.enum(THREAD_MEDIA_FILTERS).optional(),
  /** Only audio or only template messages (counts as above). Not combined with `type`. */
  kind: z.enum(THREAD_TYPE_FILTERS).optional(),
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
  /** Message attachments. Contact CSVs use POST /imports/upload-url. */
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
