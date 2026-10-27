import { describe, expect, it } from 'vitest'
import {
  mediaKindOf,
  type MessageTemplateSnapshot,
  renderTemplateSnapshot,
  snapshotText,
  type TemplateComponents,
  variablesFromMetaComponents,
} from '../src'

const components: TemplateComponents = {
  header: { format: 'TEXT', text: 'Order {{1}}' },
  body: { text: 'Hi {{1}},\nyour order {{2}} is on its way.' },
  footer: { text: 'Reply STOP to opt out' },
  buttons: [
    { type: 'QUICK_REPLY', text: 'Track' },
    { type: 'URL', text: 'Open order', url: 'https://shop.example/o/{{1}}' },
    { type: 'PHONE_NUMBER', text: 'Call us', phoneE164: '+919876543210' },
    { type: 'COPY_CODE', example: 'SAVE10' },
  ],
}
const render = (over: Partial<Parameters<typeof renderTemplateSnapshot>[0]> = {}) =>
  renderTemplateSnapshot({
    name: 'order_update',
    language: 'en',
    category: 'UTILITY',
    components,
    values: { header: ['#42'], body: ['Asha', 'A-42'], buttons: { '1': ['A-42'] } },
    ...over,
  })

describe('renderTemplateSnapshot', () => {
  it('renders a text header, body with variables and line breaks, footer and every button type', () => {
    const s = render()
    expect(s.header).toEqual({ type: 'TEXT', text: 'Order #42' })
    expect(s.body).toBe('Hi Asha,\nyour order A-42 is on its way.')
    expect(s.footer).toBe('Reply STOP to opt out')
    expect(s.buttons).toEqual([
      { type: 'QUICK_REPLY', label: 'Track' },
      { type: 'URL', label: 'Open order', url: 'https://shop.example/o/A-42' },
      { type: 'PHONE_NUMBER', label: 'Call us', phoneE164: '+919876543210' },
      { type: 'COPY_CODE', label: 'Copy code', code: 'SAVE10' },
    ])
    expect(s).toMatchObject({ v: 1, name: 'order_update', language: 'en', partial: false })
    expect(s.variables.body).toEqual(['Asha', 'A-42'])
  })

  it.each(['IMAGE', 'VIDEO', 'DOCUMENT'] as const)('keeps a %s header as a file reference', (format) => {
    const file = { id: '0190a0a0-0000-7000-8000-000000000001', filename: 'x', mimeType: 'm' }
    const s = render({
      components: { ...components, header: { format, sampleFileId: null } },
      headerFile: file,
    })
    expect(s.header).toEqual({ type: format, fileId: file.id, filename: 'x', mimeType: 'm' })
    expect(s.partial).toBe(false)
    expect(mediaKindOf({ type: 'TEMPLATE', templateSnapshot: s })).toBe(format)
  })

  it('a media header without its file is partial', () => {
    const s = render({ components: { ...components, header: { format: 'IMAGE', sampleFileId: null } } })
    expect(s.header).toMatchObject({ type: 'IMAGE', fileId: null })
    expect(s).toMatchObject({ partial: true, missing: ['header.file'] })
  })

  it('a copy-code value sent overrides the example', () => {
    const s = render({ values: { header: ['1'], body: ['a', 'b'], buttons: { '1': ['x'], '3': ['WELCOME5'] } } })
    expect(s.buttons[3]).toEqual({ type: 'COPY_CODE', label: 'Copy code', code: 'WELCOME5' })
  })

  it('missing values keep the placeholder and mark the snapshot partial', () => {
    const s = render({ values: { body: ['Asha'] } })
    expect(s.body).toBe('Hi Asha,\nyour order {{2}} is on its way.')
    expect(s.partial).toBe(true)
    expect(s.missing).toEqual(['header.0', 'body.1', 'buttons.1.0'])
  })

  it('an unresolvable template keeps name, language and values only', () => {
    const s = render({ components: null })
    expect(s).toMatchObject({ body: null, buttons: [], partial: true, missing: ['template'] })
    expect(s.variables.body).toEqual(['Asha', 'A-42'])
  })

  it('authentication renders the fixed code body, options and one copy-code button', () => {
    const s = render({
      category: 'AUTHENTICATION',
      components: {
        body: { text: '{{1}} is your verification code.' },
        buttons: [{ type: 'COPY_CODE', example: '123456' }],
        auth: { securityRecommendation: true, codeExpirationMinutes: 10 },
      },
      values: { body: ['834201'] },
    })
    expect(s.body).toBe('834201 is your verification code. For your security, do not share this code.')
    expect(s.footer).toBe('This code expires in 10 minutes.')
    expect(s.buttons).toEqual([{ type: 'COPY_CODE', label: 'Copy code', code: '834201' }])
    expect(s.partial).toBe(false)
  })

  it('snapshotText joins header text, body and footer for search', () => {
    expect(snapshotText(render())).toBe(
      'Order #42\nHi Asha,\nyour order A-42 is on its way.\nReply STOP to opt out',
    )
  })
})

describe('variablesFromMetaComponents', () => {
  it('reads header, body, URL and copy-code parameters back out of a Meta payload', () => {
    expect(
      variablesFromMetaComponents([
        { type: 'header', parameters: [{ type: 'text', text: '#42' }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'A-42' }] },
        { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'A-42' }] },
        { type: 'button', sub_type: 'copy_code', index: 3, parameters: [{ type: 'coupon_code', coupon_code: 'SAVE' }] },
      ]),
    ).toEqual({ header: ['#42'], body: ['Asha', 'A-42'], buttons: { '1': ['A-42'], '3': ['SAVE'] } })
  })

  it('skips media headers and junk', () => {
    expect(
      variablesFromMetaComponents([
        { type: 'header', parameters: [{ type: 'image', image: { id: 'm' } }] },
        null,
        'x',
      ]),
    ).toEqual({ body: [] })
    expect(variablesFromMetaComponents(undefined)).toEqual({ body: [] })
  })
})

describe('mediaKindOf', () => {
  const snap = (header: MessageTemplateSnapshot['header']) =>
    ({ ...render(), header }) as MessageTemplateSnapshot
  it('classifies media messages and template media headers; stickers, audio and text are not media', () => {
    expect(mediaKindOf({ type: 'IMAGE' })).toBe('IMAGE')
    expect(mediaKindOf({ type: 'VIDEO' })).toBe('VIDEO')
    expect(mediaKindOf({ type: 'DOCUMENT' })).toBe('DOCUMENT')
    expect(mediaKindOf({ type: 'STICKER' })).toBeNull()
    expect(mediaKindOf({ type: 'AUDIO' })).toBeNull()
    expect(mediaKindOf({ type: 'TEXT' })).toBeNull()
    expect(mediaKindOf({ type: 'TEMPLATE', templateSnapshot: null })).toBeNull()
    expect(mediaKindOf({ type: 'TEMPLATE', templateSnapshot: snap({ type: 'TEXT', text: 'x' }) })).toBeNull()
    expect(
      mediaKindOf({
        type: 'TEMPLATE',
        templateSnapshot: snap({ type: 'VIDEO', fileId: null, filename: null, mimeType: null }),
      }),
    ).toBe('VIDEO')
  })
})
