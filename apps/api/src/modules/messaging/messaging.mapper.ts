import {
  type Conversation,
  type Message,
  type MessageContent,
  messageContentSchema,
} from '@fenwira/contracts'
import { type Prisma } from '@fenwira/database'

type MessageRow = Prisma.MessageGetPayload<object>
const iso = (d: Date | null) => d?.toISOString() ?? null

export function toMessage(m: MessageRow): Message {
  const parsed = messageContentSchema.safeParse(m.content)
  return {
    id: m.id,
    conversationId: m.conversationId,
    contactId: m.contactId,
    direction: m.direction,
    type: m.type,
    status: m.status,
    source: m.source,
    content: parsed.success ? parsed.data : { type: 'UNSUPPORTED' },
    providerMessageId: m.providerMessageId,
    errorCode: m.errorCode,
    errorDetail: m.errorDetail,
    sentByUserId: m.sentByUserId,
    sentAt: iso(m.sentAt),
    deliveredAt: iso(m.deliveredAt),
    readAt: iso(m.readAt),
    failedAt: iso(m.failedAt),
    providerTimestamp: iso(m.providerTimestamp),
    createdAt: m.createdAt.toISOString(),
  }
}

export const CONVERSATION_INCLUDE = {
  contact: true,
  phoneNumber: { select: { id: true, displayPhoneNumber: true } },
} as const satisfies Prisma.ConversationInclude

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>

export function toConversation(c: ConversationRow): Conversation {
  return {
    id: c.id,
    status: c.status,
    contact: {
      id: c.contact.id,
      phoneE164: c.contact.phoneE164,
      name: c.contact.name,
      waProfileName: c.contact.waProfileName,
    },
    phoneNumber: c.phoneNumber,
    lastMessageAt: iso(c.lastMessageAt),
    lastMessagePreview: c.lastMessagePreview,
    lastCustomerMessageAt: iso(c.lastCustomerMessageAt),
    serviceWindowExpiresAt: iso(c.serviceWindowExpiresAt),
    createdAt: c.createdAt.toISOString(),
  }
}

const MEDIA_LABEL: Record<string, string> = {
  IMAGE: '📷 Photo',
  VIDEO: '🎥 Video',
  AUDIO: '🎤 Audio',
  DOCUMENT: '📄 Document',
  STICKER: 'Sticker',
  LOCATION: '📍 Location',
  CONTACTS: '👤 Contact',
}

/** Conversation-list preview (≤140 chars). */
export function previewOf(content: MessageContent): string {
  const cut = (s: string) => (s.length > 140 ? `${s.slice(0, 139)}…` : s)
  switch (content.type) {
    case 'TEXT':
      return cut(content.text)
    case 'TEMPLATE':
      return cut(`Template: ${content.name}`)
    case 'INTERACTIVE':
      return cut(content.text ?? 'Interactive reply')
    case 'REACTION':
      return `Reacted ${content.emoji}`
    case 'UNSUPPORTED':
      return 'Unsupported message'
    case 'SYSTEM_EVENT':
      return cut(content.event)
    default: {
      const caption = 'caption' in content ? content.caption : undefined
      return cut(caption ? `${MEDIA_LABEL[content.type]}: ${caption}` : MEDIA_LABEL[content.type]!)
    }
  }
}

/** E.164 with "+" for storage; Meta wants digits only. */
export const toE164 = (digitsOrPlus: string) => `+${digitsOrPlus.replace(/^\+/, '')}`
export const toWaId = (e164: string) => e164.replace(/^\+/, '')
