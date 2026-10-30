import { type Conversation, type Message, messagePreview } from '@fenwira/contracts'

export type PreviewKind = 'template' | 'document' | 'image' | 'audio' | 'video'
export type ConversationPreview = {
  text: string
  kind?: PreviewKind
  failed?: boolean
  deliveryStatus?: Message['status']
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const friendlyName = (name: string) => oneLine(name.replace(/_/g, ' '))

/** Only the known generated seed-name pattern gets a numbered avatar. Human names keep initials. */
export function conversationAvatarLabel(name: string): string | undefined {
  return /^Textile Demo Shopper (\d{1,4})$/i.exec(name.trim())?.[1]
}

/** Use an existing thread's latest customer/workspace message, never a filtered media page. */
export function latestPreviewMessage(messages: Message[]): Message | undefined {
  return messages.reduce<Message | undefined>(
    (latest, message) =>
      message.direction !== 'SYSTEM' && (!latest || message.createdAt > latest.createdAt)
        ? message
        : latest,
    undefined,
  )
}

/**
 * Summaries lack direction, type and delivery status. Enrich only from a matching, already-loaded
 * message; never label a search excerpt or an older cached message as the latest outbound send.
 */
export function conversationPreview(
  conversation: Pick<Conversation, 'lastMessagePreview' | 'lastMessageAt' | 'snippet'>,
  message?: Message,
): ConversationPreview {
  if (conversation.snippet?.trim()) return { text: oneLine(conversation.snippet) }
  if (
    !message ||
    message.createdAt !== conversation.lastMessageAt ||
    message.direction === 'SYSTEM'
  ) {
    const summary = oneLine(conversation.lastMessagePreview ?? '')
    const template = /^Template: (.+)$/.exec(summary)
    return template
      ? { kind: 'template', text: `Template · ${friendlyName(template[1]!)}` }
      : { text: summary || (conversation.lastMessageAt ? 'Message' : 'No messages yet') }
  }

  const content = message.content
  const outbound = message.direction === 'OUTBOUND'
  let text: string
  let kind: PreviewKind | undefined
  switch (content.type) {
    case 'TEMPLATE': {
      kind = 'template'
      const snapshot = message.templateSnapshot
      // A partial body may still contain unsubstituted variables. Never invent their values.
      const body = snapshot?.body?.trim()
      text =
        body && !/\{\{.*?\}\}/.test(body)
          ? body
          : `Template · ${friendlyName(snapshot?.name ?? content.name)}`
      break
    }
    case 'DOCUMENT':
      kind = 'document'
      text = message.media?.filename ?? content.filename ?? 'Document'
      break
    case 'IMAGE':
      kind = 'image'
      text = content.caption?.trim() || 'Photo'
      break
    case 'AUDIO':
      kind = 'audio'
      text = 'Audio'
      break
    case 'VIDEO':
      kind = 'video'
      text = content.caption?.trim() || 'Video'
      break
    default:
      text = messagePreview(content, message.templateSnapshot)
  }
  return {
    text: `${outbound ? 'You: ' : ''}${oneLine(text)}`,
    kind,
    failed: outbound && message.status === 'FAILED',
    deliveryStatus: outbound ? message.status : undefined,
  }
}
