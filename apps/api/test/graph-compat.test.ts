import { graphSendRequestSchema } from '@fenwira/contracts'
import { MEDIA_PLACEHOLDER } from '@fenwira/whatsapp'
import { describe, expect, it } from 'vitest'
import { graphSendToContent } from '../src/modules/messaging/graph-compat'

/** Meta-compatible send (docs/API_KEYS.md → Meta-compatible send): body validation and mapping. */
const parse = (body: unknown) => graphSendRequestSchema.parse(body)
const FILE_ID = '01a17ecf-14fb-71f2-93a2-e593adeeacc8'

describe('graphSendRequestSchema', () => {
  it('accepts the body a Meta client already sends, number with or without +', () => {
    const body = parse({
      messaging_product: 'whatsapp',
      to: '+91 95000-42603',
      type: 'template',
      template: { name: 'magilshe_invoice_generated', language: { code: 'en' } },
    })
    expect(body.to).toBe('919500042603')
  })

  it('defaults to text like Meta, and needs the object matching the type', () => {
    expect(parse({ to: '919500042603', text: { body: 'Hi' } }).type).toBe('text')
    expect(() => parse({ to: '919500042603', type: 'template', text: { body: 'Hi' } })).toThrow()
    expect(() => parse({ to: '919500042603', type: 'image' })).toThrow()
  })

  it('rejects a number without its country code', () => {
    expect(() => parse({ to: '0123', text: { body: 'Hi' } })).toThrow()
  })
})

describe('graphSendToContent', () => {
  it('maps text', () => {
    expect(graphSendToContent(parse({ to: '919500042603', text: { body: 'Hi' } }))).toEqual({
      type: 'TEXT',
      text: 'Hi',
      previewUrl: undefined,
    })
  })

  it('turns a Fenwira file in a template header into the send header file', () => {
    const content = graphSendToContent(
      parse({
        to: '919500042603',
        type: 'template',
        template: {
          name: 'magilshe_invoice_generated',
          language: { code: 'en' },
          components: [
            {
              type: 'header',
              parameters: [
                { type: 'document', document: { id: FILE_ID, filename: 'Invoice-45.pdf' } },
              ],
            },
            { type: 'body', parameters: [{ type: 'text', text: 'Priya' }] },
          ],
        },
      }),
    )
    expect(content).toMatchObject({
      type: 'TEMPLATE',
      name: 'magilshe_invoice_generated',
      language: 'en',
      variables: { body: [], headerFileId: FILE_ID },
    })
    expect((content as { components: unknown[] }).components[0]).toEqual({
      type: 'header',
      parameters: [
        { type: 'document', document: { id: MEDIA_PLACEHOLDER, filename: 'Invoice-45.pdf' } },
      ],
    })
  })

  it('passes a link or a Meta media id through unchanged', () => {
    const components = [
      {
        type: 'header',
        parameters: [{ type: 'image', image: { link: 'https://cdn.example/banner.png' } }],
      },
    ]
    const content = graphSendToContent(
      parse({
        to: '919500042603',
        type: 'template',
        template: { name: 'promo', language: { code: 'en' }, components },
      }),
    )
    expect(content).toEqual({ type: 'TEMPLATE', name: 'promo', language: 'en', components })
  })
})
