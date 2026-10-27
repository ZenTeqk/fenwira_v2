import {
  type Message,
  type MessageContent,
  messageContentSchema,
  type MessageTemplateSnapshot,
  messageTemplateSnapshotSchema,
} from '@fenwira/contracts'
import { type Prisma } from '@fenwira/database'

/** The thread includes the file (filter views list name, type and size). */
export const MESSAGE_FILE_SELECT = {
  file: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.MessageInclude
type MessageRow = Prisma.MessageGetPayload<object> & {
  file?: { id: string; filename: string | null; mimeType: string; sizeBytes: bigint } | null
}
const iso = (d: Date | null) => d?.toISOString() ?? null
export function toMessage(m: MessageRow): Message {
  const parsed = messageContentSchema.safeParse(m.content)
  const snapshot = m.templateSnapshot
    ? messageTemplateSnapshotSchema.safeParse(m.templateSnapshot)
    : null
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
    templateSnapshot: snapshot?.success ? snapshot.data : null,
    ...(m.file !== undefined
      ? {
          media: m.file
            ? {
                fileId: m.file.id,
                filename: m.file.filename,
                mimeType: m.file.mimeType,
                sizeBytes: Number(m.file.sizeBytes),
              }
            : null,
        }
      : {}),
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

/** Conversation-list preview (≤140 chars); a template shows its rendered body when known. */
export function previewOf(
  content: MessageContent,
  snapshot?: MessageTemplateSnapshot | null,
): string {
  const cut = (s: string) => (s.length > 140 ? `${s.slice(0, 139)}…` : s)
  switch (content.type) {
    case 'TEXT':
      return cut(content.text)
    case 'TEMPLATE':
      return cut(snapshot?.body ?? `Template: ${content.name}`)
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
