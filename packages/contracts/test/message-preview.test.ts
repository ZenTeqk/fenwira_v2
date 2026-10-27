import { describe, expect, it } from 'vitest'
import { messagePreview } from '../src'

describe('messagePreview', () => {
  it('names each kind of message and never returns empty text or a payload', () => {
    expect(messagePreview({ type: 'TEXT', text: '  Hello there ' })).toBe('Hello there')
    expect(messagePreview({ type: 'TEXT', text: '   ' })).toBe('Message')
    expect(messagePreview({ type: 'IMAGE', fileId: 'f', caption: 'Shelf' })).toBe('Photo')
    expect(messagePreview({ type: 'VIDEO', fileId: 'f' })).toBe('Video')
    expect(messagePreview({ type: 'DOCUMENT', fileId: 'f', filename: 'a.pdf' })).toBe('Document')
    expect(messagePreview({ type: 'AUDIO', fileId: 'f' })).toBe('Voice message')
    expect(messagePreview({ type: 'LOCATION', latitude: 1, longitude: 2 })).toBe('Location')
    expect(messagePreview({ type: 'UNSUPPORTED', metaType: 'order' })).toBe('Message')
    expect(messagePreview({ type: 'SYSTEM_EVENT', event: 'assigned', data: { a: 1 } })).toBe(
      'Message',
    )
    expect(messagePreview({ type: 'INTERACTIVE' } as never)).toBe('Message')
  })

  it('names templates by their sent snapshot, else the requested name', () => {
    const content = { type: 'TEMPLATE', name: 'hello_world', language: 'en' } as never
    expect(messagePreview(content, { name: 'order_update' })).toBe('Template: order_update')
    expect(messagePreview(content)).toBe('Template: hello_world')
  })

  it('cuts long text to 140 characters', () => {
    const preview = messagePreview({ type: 'TEXT', text: 'x'.repeat(300) })
    expect(preview).toHaveLength(140)
    expect(preview.endsWith('…')).toBe(true)
  })
})
