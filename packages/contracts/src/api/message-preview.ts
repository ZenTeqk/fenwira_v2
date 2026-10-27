import { type MessageTemplateSnapshot } from '../templates/snapshot'
import { type MessageContent } from './messaging'

const MAX = 140
const cut = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s)
const LABEL: Partial<Record<MessageContent['type'], string>> = {
  IMAGE: 'Photo',
  VIDEO: 'Video',
  AUDIO: 'Voice message',
  DOCUMENT: 'Document',
  STICKER: 'Sticker',
  LOCATION: 'Location',
  CONTACTS: 'Contact',
  REACTION: 'Reaction',
}

/**
 * One line describing a message for the conversation list (docs/INBOX.md → List): its text, or
 * its kind ("Photo", "Template: order_update", …). Never empty and never a raw payload.
 */
export function messagePreview(
  content: MessageContent,
  snapshot?: Pick<MessageTemplateSnapshot, 'name'> | null,
): string {
  switch (content.type) {
    case 'TEXT':
      return content.text.trim() ? cut(content.text.trim()) : 'Message'
    case 'TEMPLATE':
      return cut(`Template: ${snapshot?.name ?? content.name}`)
    case 'INTERACTIVE':
      return content.text?.trim() ? cut(content.text.trim()) : 'Message'
    default:
      return LABEL[content.type] ?? 'Message'
  }
}
