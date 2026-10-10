import { describe, expect, it } from 'vitest'
import { normalizeWebhook, signWebhookBody, verifyWebhookSignature } from '../src'
import { inboundMessageWebhook, messagesEnvelope, statusWebhook } from '../src/testing'

const ids = { wabaId: '100', phoneNumberId: '200' }

describe('webhook signature', () => {
  it('verifies the raw body with the app secret and rejects anything else', () => {
    const raw = Buffer.from(JSON.stringify({ a: 1 }))
    const header = signWebhookBody('secret', raw)
    expect(verifyWebhookSignature('secret', raw, header)).toBe(true)
    expect(verifyWebhookSignature('other', raw, header)).toBe(false)
    expect(verifyWebhookSignature('secret', Buffer.from('{"a": 1}'), header)).toBe(false)
    expect(verifyWebhookSignature('secret', raw, undefined)).toBe(false)
    expect(verifyWebhookSignature('secret', raw, 'sha256=00')).toBe(false)
  })
})

describe('normalizeWebhook', () => {
  it('normalizes an inbound text with the profile name', () => {
    const [e] = normalizeWebhook(
      inboundMessageWebhook(ids, {
        from: '919876543210',
        wamid: 'wamid.A',
        name: 'Asha',
        text: 'Hi',
        timestamp: 1_700_000_000,
      }),
    )
    expect(e).toMatchObject({
      kind: 'MESSAGE',
      dedupeKey: 'msg:wamid.A',
      phoneNumberId: '200',
      message: {
        from: '919876543210',
        profileName: 'Asha',
        type: 'TEXT',
        content: { type: 'TEXT', text: 'Hi' },
        timestamp: '2023-11-14T22:13:20.000Z',
      },
    })
  })

  it('maps media, button replies, reactions and unknown types', () => {
    const kinds = [
      { type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'c' } },
      {
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes' } },
      },
      { type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } },
      { type: 'ephemeral' },
    ].map(
      (body, i) =>
        normalizeWebhook(inboundMessageWebhook(ids, { from: '1', wamid: `w${i}`, body }))[0],
    )
    expect(kinds.map((k) => k?.kind === 'MESSAGE' && k.message.content)).toEqual([
      { type: 'IMAGE', mediaId: 'm1', mimeType: 'image/jpeg', caption: 'c', filename: undefined },
      { type: 'INTERACTIVE', text: 'Yes', replyId: 'yes', interactive: expect.anything() },
      { type: 'REACTION', emoji: '👍', providerMessageId: 'wamid.X' },
      { type: 'UNSUPPORTED', metaType: 'ephemeral' },
    ])
  })

  it('builds status dedupe keys, including the error code for failures', () => {
    const [read] = normalizeWebhook(statusWebhook(ids, { wamid: 'wamid.B', status: 'read' }))
    expect(read).toMatchObject({ kind: 'STATUS', dedupeKey: 'st:wamid.B:read' })
    const [failed] = normalizeWebhook(
      statusWebhook(ids, { wamid: 'wamid.B', status: 'failed', errorCode: 131026 }),
    )
    expect(failed).toMatchObject({
      dedupeKey: 'st:wamid.B:failed:131026',
      status: { error: { code: 131026 } },
    })
  })

  it('keeps WABA-level fields and ignores foreign or malformed payloads', () => {
    const tpl = normalizeWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '100',
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_id: 9 },
            },
          ],
        },
      ],
    })
    expect(tpl).toMatchObject([{ kind: 'TEMPLATE_STATUS', wabaId: '100', phoneNumberId: null }])
    expect(normalizeWebhook({ object: 'page', entry: [] })).toEqual([])
    expect(normalizeWebhook('nope')).toEqual([])
    expect(
      normalizeWebhook(messagesEnvelope(ids, { statuses: [{ id: 'x', status: 'weird' }] })),
    ).toEqual([])
  })
})
