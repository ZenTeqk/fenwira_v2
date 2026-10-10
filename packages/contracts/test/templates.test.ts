import { describe, expect, it } from 'vitest'
import {
  AUTH_BODY_TEXT,
  missingVariables,
  renderTemplateText,
  requiredVariables,
  type TemplateDraft,
  validateTemplate,
} from '../src'

const base: TemplateDraft = {
  name: 'order_update',
  language: 'en',
  category: 'UTILITY',
  components: {
    header: { format: 'TEXT', text: 'Order {{1}}' },
    body: { text: 'Hi {{1}}, your order {{2}} is on its way and arrives soon.' },
    footer: { text: 'Thanks for shopping' },
    buttons: [
      { type: 'QUICK_REPLY', text: 'Help' },
      { type: 'URL', text: 'Track', url: 'https://shop.example/t/{{1}}' },
    ],
  },
  samples: { header: ['#1'], body: ['Asha', '#1'], buttons: { '1': ['1'] } },
}
const codes = (d: TemplateDraft) => validateTemplate(d).errors.map((e) => e.code)
const withBody = (text: string, body = base.samples.body) => ({
  ...base,
  components: { ...base.components, body: { text } },
  samples: { ...base.samples, body },
})

describe('validateTemplate (shared by the builder and the API)', () => {
  it('accepts a well-formed template', () => {
    expect(validateTemplate(base)).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('names: lowercase letters, digits and underscores only', () => {
    for (const name of ['Order', 'order-update', 'order update', ''])
      expect(codes({ ...base, name })).toContain('TEMPLATE_NAME_INVALID')
  })

  it('variables must be sequential from {{1}} with no gaps; the header allows one', () => {
    expect(codes(withBody('Hi {{1}}, order {{3}} ships today to you.', ['a', 'b', 'c']))).toContain(
      'TEMPLATE_VARIABLES_NOT_SEQUENTIAL',
    )
    expect(
      codes({
        ...base,
        components: { ...base.components, header: { format: 'TEXT', text: '{{1}} and {{2}}' } },
        samples: { ...base.samples, header: ['a', 'b'] },
      }),
    ).toContain('TEMPLATE_VARIABLES_NOT_SEQUENTIAL')
  })

  it("variables can't be adjacent, and the body can't start or end with one", () => {
    expect(codes(withBody('Hi {{1}}{{2}} there, your order is ready.'))).toContain(
      'TEMPLATE_VARIABLE_PLACEMENT',
    )
    expect(codes(withBody('{{1}}, your order {{2}} is ready.'))).toContain(
      'TEMPLATE_VARIABLE_PLACEMENT',
    )
    expect(codes(withBody('Your order {{2}} is ready, {{1}}'))).toContain(
      'TEMPLATE_VARIABLE_PLACEMENT',
    )
  })

  it('every variable needs a sample', () => {
    expect(codes(withBody(base.components.body.text, ['Asha', ' ']))).toContain(
      'TEMPLATE_SAMPLE_MISSING',
    )
    expect(codes({ ...base, samples: { ...base.samples, buttons: {} } })).toContain(
      'TEMPLATE_SAMPLE_MISSING',
    )
  })

  it('length limits per component', () => {
    expect(codes(withBody(`Hi ${'x'.repeat(1030)} {{1}} ok {{2}} done.`))).toContain(
      'TEMPLATE_TOO_LONG',
    )
    expect(
      codes({ ...base, components: { ...base.components, footer: { text: 'f'.repeat(61) } } }),
    ).toContain('TEMPLATE_TOO_LONG')
    expect(
      codes({
        ...base,
        components: {
          ...base.components,
          buttons: [{ type: 'QUICK_REPLY', text: 'b'.repeat(26) }],
        },
      }),
    ).toContain('TEMPLATE_TOO_LONG')
  })

  it('button rules: ≤10, grouped, ≤2 URL, ≤1 phone, ≤1 copy code', () => {
    const qr = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ type: 'QUICK_REPLY' as const, text: `B${i}` }))
    const url = { type: 'URL' as const, text: 'Go', url: 'https://a.example' }
    const phone = { type: 'PHONE_NUMBER' as const, text: 'Call', phoneE164: '+919876543210' }
    const set = (buttons: NonNullable<TemplateDraft['components']['buttons']>) =>
      codes({
        ...base,
        components: { ...base.components, buttons },
        samples: { ...base.samples, buttons: {} },
      })
    expect(set(qr(11))).toContain('TEMPLATE_BUTTONS_INVALID')
    expect(set([url, url, url])).toContain('TEMPLATE_BUTTONS_INVALID')
    expect(set([phone, phone])).toContain('TEMPLATE_BUTTONS_INVALID')
    expect(set([...qr(1), url, ...qr(1)])).toContain('TEMPLATE_BUTTONS_INVALID')
    expect(set([...qr(3), url, phone])).toEqual([])
    expect(set([{ ...phone, phoneE164: '98765' }])).toContain('TEMPLATE_BUTTONS_INVALID')
    expect(set([{ ...url, url: 'http://a.example/{{1}}/x' }])).toContain('TEMPLATE_BUTTONS_INVALID')
  })

  it('a media header needs a sample file', () => {
    expect(
      codes({
        ...base,
        components: { ...base.components, header: { format: 'IMAGE', sampleFileId: null } },
      }),
    ).toContain('TEMPLATE_MEDIA_INVALID')
  })

  it('warns (never blocks) on too many variables and marketing wording in UTILITY', () => {
    const dense = validateTemplate(withBody('Hi {{1}} and {{2}} ok.', ['a', 'b']))
    expect(dense.warnings.map((w) => w.code)).toContain('TEMPLATE_TOO_MANY_VARIABLES')
    const salesy = validateTemplate(
      withBody('Hi {{1}}, get 20% off in our sale for order {{2}} today.'),
    )
    expect(salesy.valid).toBe(true)
    expect(salesy.warnings.map((w) => w.code)).toContain('TEMPLATE_CATEGORY_MISMATCH')
    expect(
      validateTemplate({
        ...withBody('Hi {{1}}, get 20% off in our sale for {{2}} today.'),
        category: 'MARKETING',
      }).warnings,
    ).toEqual([])
  })

  it('AUTHENTICATION uses the fixed OTP format only', () => {
    const auth: TemplateDraft = {
      name: 'login_code',
      language: 'en',
      category: 'AUTHENTICATION',
      components: {
        body: { text: AUTH_BODY_TEXT },
        buttons: [{ type: 'COPY_CODE', example: '123456' }],
        auth: { securityRecommendation: true, codeExpirationMinutes: 10 },
      },
      samples: { body: ['123456'] },
    }
    expect(validateTemplate(auth).valid).toBe(true)
    expect(
      codes({
        ...auth,
        components: { ...auth.components, body: { text: 'Your code {{1}} here' } },
      }),
    ).toContain('TEMPLATE_AUTH_FORMAT')
    expect(
      codes({ ...auth, components: { ...auth.components, header: { format: 'TEXT', text: 'x' } } }),
    ).toContain('TEMPLATE_AUTH_FORMAT')
  })
})

describe('send helpers', () => {
  it('lists required values and finds missing ones', () => {
    expect(requiredVariables(base.components)).toEqual({
      header: 1,
      body: 2,
      buttons: { '1': 1 },
      headerMedia: null,
    })
    expect(missingVariables(base.components, { body: ['Asha'] })).toEqual([
      'header.0',
      'body.1',
      'buttons.1.0',
    ])
    expect(
      missingVariables(base.components, {
        header: ['#9'],
        body: ['A', 'B'],
        buttons: { '1': ['9'] },
      }),
    ).toEqual([])
  })

  it('renders previews with sample values', () => {
    expect(renderTemplateText('Hi {{1}}, order {{2}}', ['Asha'])).toBe('Hi Asha, order {{2}}')
  })
})
