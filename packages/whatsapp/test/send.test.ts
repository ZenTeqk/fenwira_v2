import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GraphClient, type GraphError } from '../src'
import { buildSendPayload, MessageSender } from '../src/send'
import { DEMO_PHONE_ID, DEMO_WABA_ID, type MetaMockState, startMetaMock } from '../src/testing'

const token = `mock-dev:${DEMO_WABA_ID}`
let server: Server
let state: MetaMockState
let sender: MessageSender
let client: GraphClient

beforeAll(async () => {
  const mock = await startMetaMock(0)
  server = mock.server
  state = mock.state
  sender = new MessageSender({ baseUrl: mock.url, version: 'v23.0' })
  client = new GraphClient({ baseUrl: mock.url, version: 'v23.0' })
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('buildSendPayload', () => {
  it('maps text, template and media content to Graph bodies', () => {
    expect(buildSendPayload('919876543210', { type: 'TEXT', text: 'Hi' })).toMatchObject({
      to: '919876543210',
      type: 'text',
      text: { body: 'Hi', preview_url: false },
    })
    expect(
      buildSendPayload('1', { type: 'TEMPLATE', name: 'hello_world', language: 'en_US' }),
    ).toMatchObject({
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    })
    const fileId = '0192a000-0000-7000-8000-000000000000'
    expect(
      buildSendPayload(
        '1',
        { type: 'DOCUMENT', fileId, caption: 'Invoice', filename: 'a.pdf' },
        'm1',
      ),
    ).toMatchObject({
      type: 'document',
      document: { id: 'm1', caption: 'Invoice', filename: 'a.pdf' },
    })
    expect(() => buildSendPayload('1', { type: 'IMAGE', fileId })).toThrow(/media id/)
  })
})

describe('MessageSender against meta-mock', () => {
  it('sends text and returns the wamid', async () => {
    const res = await sender.sendMessage(
      token,
      DEMO_PHONE_ID,
      buildSendPayload('15550100002', { type: 'TEXT', text: 'Hi' }),
    )
    expect(res.providerMessageId).toMatch(/^wamid\./)
    expect(state.sent.at(-1)?.payload).toMatchObject({ type: 'text' })
  })

  it('uploads media, sends it, and the media can be read back', async () => {
    const bytes = Buffer.from('%PDF-1.4 test')
    const mediaId = await sender.uploadMedia(token, DEMO_PHONE_ID, {
      bytes,
      mimeType: 'application/pdf',
      filename: 'a.pdf',
    })
    const fileId = '0192a000-0000-7000-8000-000000000000'
    await sender.sendMessage(
      token,
      DEMO_PHONE_ID,
      buildSendPayload('1', { type: 'DOCUMENT', fileId }, mediaId),
    )
    const meta = await client.getMediaUrl(token, mediaId)
    expect(meta.mime_type).toBe('application/pdf')
    const downloaded = await client.downloadMedia(token, meta.url)
    expect(downloaded.bytes.includes(bytes)).toBe(true)
  })

  it('rejects a revoked token as CREDENTIAL', async () => {
    const other = `mock-dev:${DEMO_WABA_ID}:revoked`
    state.revoked.add(other)
    const err = await sender.markRead(other, DEMO_PHONE_ID, 'wamid.x').catch((e: unknown) => e)
    expect((err as GraphError).classification).toBe('CREDENTIAL')
  })
})
