import { type Message, type MessageContent, type MessageTemplateSnapshot } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  conversationAvatarLabel,
  conversationPreview,
  latestPreviewMessage,
} from '../lib/conversation-preview'

const at = '2026-10-30T09:00:00.000Z'
const summary = { lastMessageAt: at, lastMessagePreview: 'Stored excerpt' }
const message = (content: MessageContent, extra: Partial<Message> = {}): Message => ({
  id: 'latest',
  conversationId: 'conversation',
  contactId: 'contact',
  direction: 'OUTBOUND',
  type: content.type,
  content,
  status: 'SENT',
  source: 'INBOX',
  createdAt: at,
  aiGenerated: false,
  providerMessageId: null,
  errorCode: null,
  errorDetail: null,
  sentByUserId: 'agent',
  sentAt: at,
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  providerTimestamp: null,
  templateSnapshot: null,
  ...extra,
})
const template = (body: string | null): MessageTemplateSnapshot => ({
  v: 1,
  name: 'delivery_update',
  language: 'en',
  category: 'UTILITY',
  header: null,
  body,
  footer: null,
  buttons: [],
  variables: { body: [] },
  partial: body === null,
  missing: [],
})

describe('truthful conversation previews', () => {
  it('preserves a search excerpt without attributing it to the latest sender', () => {
    expect(
      conversationPreview(
        { ...summary, snippet: 'Matching old message' },
        message({ type: 'TEXT', text: 'New reply' }),
      ),
    ).toEqual({ text: 'Matching old message' })
  })
  it('uses summaries when message data is absent or stale, without inventing a direction', () => {
    expect(conversationPreview(summary)).toEqual({ text: 'Stored excerpt' })
    expect(
      conversationPreview(
        summary,
        message({ type: 'TEXT', text: 'Old reply' }, { createdAt: '2026-10-29T09:00:00.000Z' }),
      ),
    ).toEqual({ text: 'Stored excerpt' })
    expect(
      conversationPreview({ ...summary, lastMessagePreview: 'Template: order_status_update' }),
    ).toEqual({ text: 'Template · order status update', kind: 'template' })
    expect(
      conversationPreview({ ...summary, lastMessageAt: null, lastMessagePreview: null }),
    ).toEqual({ text: 'No messages yet' })
  })
  it('labels actual outgoing text and leaves incoming text unprefixed', () => {
    const content = { type: 'TEXT', text: ' Your order\n is ready. ' } as const
    expect(conversationPreview(summary, message(content)).text).toBe('You: Your order is ready.')
    expect(conversationPreview(summary, message(content, { direction: 'INBOUND' })).text).toBe(
      'Your order is ready.',
    )
  })
  it('uses frozen template text, with an honest name fallback for missing/unresolved bodies', () => {
    const content = { type: 'TEMPLATE', name: 'delivery_update', language: 'en' } as const
    expect(
      conversationPreview(
        summary,
        message(content, { templateSnapshot: template('Hi Meena, your order arrives today.') }),
      ).text,
    ).toBe('You: Hi Meena, your order arrives today.')
    for (const body of [null, '', 'Hello {{1}}, your order arrives today.']) {
      expect(
        conversationPreview(summary, message(content, { templateSnapshot: template(body) })).text,
      ).toBe('You: Template · delivery update')
    }
  })
  it.each([
    [
      { type: 'DOCUMENT', fileId: 'file', filename: 'Order invoice.pdf' },
      'document',
      'You: Order invoice.pdf',
    ],
    [{ type: 'IMAGE', fileId: 'file', caption: 'Cake design' }, 'image', 'You: Cake design'],
    [{ type: 'IMAGE', fileId: 'file' }, 'image', 'You: Photo'],
    [{ type: 'AUDIO', fileId: 'file' }, 'audio', 'You: Audio'],
    [{ type: 'VIDEO', fileId: 'file' }, 'video', 'You: Video'],
  ] as const)('describes media from stored content', (content, kind, text) => {
    expect(conversationPreview(summary, message(content))).toMatchObject({ kind, text })
  })
  it('prefers actual stored attachment filenames and identifies a failed outbound send', () => {
    const latest = message(
      { type: 'DOCUMENT', fileId: 'file' },
      {
        media: {
          fileId: 'file',
          filename: 'Saved invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        },
        status: 'FAILED',
        errorDetail: 'Customer unreachable',
      },
    )
    expect(conversationPreview(summary, latest)).toMatchObject({
      text: 'You: Saved invoice.pdf',
      failed: true,
      deliveryStatus: 'FAILED',
    })
  })
  it('ignores system events and finds the newest message across cached history pages', () => {
    const older = message(
      { type: 'TEXT', text: 'Older' },
      { createdAt: '2026-10-29T09:00:00.000Z' },
    )
    const latest = message({ type: 'TEXT', text: 'Latest' })
    const system = message(
      { type: 'SYSTEM_EVENT', event: 'takeover', data: {} },
      { direction: 'SYSTEM', createdAt: '2026-10-30T09:05:00.000Z' },
    )
    expect(latestPreviewMessage([older, system, latest])).toBe(latest)
    expect(latestPreviewMessage([])).toBeUndefined()
    expect(conversationPreview(summary, system)).toEqual({ text: 'Stored excerpt' })
  })
})

describe('generated contact avatar numbers', () => {
  it('recognizes only the known generated name pattern', () => {
    expect(conversationAvatarLabel('Textile Demo Shopper 79')).toBe('79')
    for (const name of [
      'Vijay',
      'Studio 79',
      'Textile Shopper 79',
      'Textile Demo Shopper 79 Singh',
      'Shopper 79',
    ])
      expect(conversationAvatarLabel(name)).toBeUndefined()
  })
})
