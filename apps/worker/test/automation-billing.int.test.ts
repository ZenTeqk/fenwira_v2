import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  automationMessages,
  chain,
  createFlow,
  end,
  execution,
  executionsWhere,
  type Graph,
  keyword,
} from './support/automation'
import { campaignWorld, type CampaignWorld, metaId } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'

/**
 * P10-D1 with BILLING_ENFORCED=true and an empty wallet: a billable automation send records
 * INSUFFICIENT_FUNDS, follows the error branch when there is one, otherwise fails. Never retried.
 */
const SECRET = 'automation-billing-secret'
const ENV = { BILLING_ENFORCED: 'true' }
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const customer = () => `9198${String(Math.random()).slice(2, 10)}`
const inbound = (w: CampaignWorld, from: string, body: string) =>
  deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text: body, name: 'Ada' }),
  )

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
    ...ENV,
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: [], delayMs: 20 }
  worker = await bootWorker({
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
    ...ENV,
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('P10-D1: insufficient funds in automation', { timeout: 120_000 }, () => {
  it('error branch when configured, FAILED otherwise; text replies stay free', async () => {
    const w = await campaignWorld(api, mock.url, 'auto-funds')
    const tmpl = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.template.findFirstOrThrow({ where: { name: 'order_update' } }),
    )
    const send = {
      id: 'tpl',
      type: 'action.send_template',
      config: { templateId: tmpl.id, variables: { body: ['{{contact.firstName}}', '#1'] } },
    }
    const withBranch: Graph = {
      nodes: [
        keyword('pay'),
        send,
        { id: 'sorry', type: 'action.send_message', config: { text: 'We will be in touch.' } },
        end('e1'),
        end('e2'),
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'tpl', sourceHandle: 'next' },
        { id: '2', source: 'tpl', target: 'e1', sourceHandle: 'next' },
        { id: '3', source: 'tpl', target: 'sorry', sourceHandle: 'error' },
        { id: '4', source: 'sorry', target: 'e2', sourceHandle: 'next' },
      ],
      layout: {},
    }
    const branched = await createFlow(w.owner, 'With branch', withBranch, { priority: 1 })
    const plain = await createFlow(w.owner, 'Without branch', chain(keyword('pay'), send), {
      priority: 2,
    })
    await inbound(w, customer(), 'pay')
    const [a] = await executionsWhere(w.owner, branched, (e) => e.status === 'COMPLETED')
    const [b] = await executionsWhere(w.owner, plain, (e) => e.status === 'FAILED')
    const da = await execution(w.owner, a!.id)
    expect(da.steps!.map((s) => `${s.nodeId}:${s.status}:${s.errorCode ?? ''}`)).toEqual([
      'trigger:SUCCEEDED:',
      'tpl:FAILED:INSUFFICIENT_FUNDS',
      'sorry:SUCCEEDED:',
      'e2:SUCCEEDED:',
    ])
    expect(b!.errorCode).toBe('INSUFFICIENT_FUNDS')
    // Never retried: exactly one attempt recorded for the template step.
    const db2 = await execution(w.owner, b!.id)
    expect(db2.steps!.filter((s) => s.nodeId === 'tpl')).toHaveLength(1)
    const msgs = await automationMessages(db, w.owner.tenantId)
    expect(msgs.map((m) => (m.content as { type?: string; text?: string }).text)).toEqual([
      'We will be in touch.',
    ])
    // No reservation was left behind.
    const held = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.walletReservation.count({ where: { status: 'ACTIVE' } }),
    )
    expect(held).toBe(0)
  })
})
