import { type TemplateComponents } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildTemplateSendComponents,
  fromMetaTemplate,
  MEDIA_PLACEHOLDER,
  templateStatusFromMeta,
  toMetaTemplatePayload,
} from '../src'
import { buildSendPayload } from '../src/send'

const components: TemplateComponents = {
  header: { format: 'TEXT', text: 'Order {{1}}' },
  body: { text: 'Hi {{1}}, order {{2}} ships today.' },
  footer: { text: 'Thanks' },
  buttons: [
    { type: 'QUICK_REPLY', text: 'Help' },
    { type: 'URL', text: 'Track', url: 'https://s.example/t/{{1}}' },
    { type: 'PHONE_NUMBER', text: 'Call', phoneE164: '+919876543210' },
  ],
}
const samples = { header: ['#1'], body: ['Asha', '#1'], buttons: { '1': ['1'] } }

describe('template payloads (docs/TEMPLATE_ENGINE.md)', () => {
  it('builds Meta components with examples from the samples', () => {
    const p = toMetaTemplatePayload({
      name: 'order',
      language: 'en',
      category: 'UTILITY',
      components,
      samples,
    })
    expect(p.components).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}', example: { header_text: ['#1'] } },
      {
        type: 'BODY',
        text: 'Hi {{1}}, order {{2}} ships today.',
        example: { body_text: [['Asha', '#1']] },
      },
      { type: 'FOOTER', text: 'Thanks' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Help' },
          { type: 'URL', text: 'Track', url: 'https://s.example/t/{{1}}', example: ['1'] },
          { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+919876543210' },
        ],
      },
    ])
  })

  it('round-trips through Meta’s shape (what a sync reads back)', () => {
    const p = toMetaTemplatePayload({
      name: 'order',
      language: 'en',
      category: 'UTILITY',
      components,
      samples,
    })
    const back = fromMetaTemplate({
      id: '1',
      name: 'order',
      language: 'en',
      status: 'APPROVED',
      category: 'UTILITY',
      components: p.components as Array<Record<string, unknown>>,
    })
    expect(back).toEqual({ components, samples })
  })

  it('media headers use the upload handle; sends carry a placeholder the worker replaces', () => {
    const media: TemplateComponents = {
      ...components,
      header: { format: 'IMAGE', sampleFileId: null },
    }
    const p = toMetaTemplatePayload(
      { name: 'o', language: 'en', category: 'MARKETING', components: media, samples },
      '4::h',
    )
    expect((p.components as unknown[])[0]).toEqual({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: ['4::h'] },
    })
    const send = buildTemplateSendComponents('MARKETING', media, {
      body: ['A', 'B'],
      buttons: { '1': ['7'] },
    })
    expect(send[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: MEDIA_PLACEHOLDER } }],
    })
    const out = buildSendPayload(
      '919876543210',
      { type: 'TEMPLATE', name: 'o', language: 'en', components: send },
      'media42',
    )
    expect(JSON.stringify(out)).toContain('"id":"media42"')
    expect(JSON.stringify(out)).not.toContain(MEDIA_PLACEHOLDER)
  })

  it('authentication templates send the code in the body and the OTP button', () => {
    const auth: TemplateComponents = {
      body: { text: '{{1}} is your verification code.' },
      buttons: [{ type: 'COPY_CODE', example: '123456' }],
      auth: { securityRecommendation: true, codeExpirationMinutes: 5 },
    }
    expect(
      toMetaTemplatePayload({
        name: 'otp',
        language: 'en',
        category: 'AUTHENTICATION',
        components: auth,
        samples: { body: ['1'] },
      }).components,
    ).toEqual([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ])
    expect(buildTemplateSendComponents('AUTHENTICATION', auth, { body: ['918273'] })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '918273' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '918273' }],
      },
    ])
  })

  it('maps Meta template statuses to ours', () => {
    expect(['APPROVED', 'REINSTATED', 'FLAGGED'].map(templateStatusFromMeta)).toEqual([
      'APPROVED',
      'APPROVED',
      'APPROVED',
    ])
    expect(templateStatusFromMeta('IN_APPEAL')).toBe('PENDING')
    expect(templateStatusFromMeta('PENDING_DELETION')).toBe('DISABLED')
  })
})
