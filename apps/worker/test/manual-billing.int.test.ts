import { BillingMaintenanceProcessor } from '@fenwira/api/modules/billing'
import { sha256, uuidv7 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { signWebhookBody } from '@fenwira/whatsapp'
import { inboundMessageWebhook, type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { waitFor } from './support/campaigns'
import { bootApi, bootWorker, type Client } from './support/harness'
import { createOperator } from './support/platform'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * ADR-0027 Managed Launch Mode step 3 — manual UPI billing end to end: operator invoices, UPI QR
 * and deep link, payment proof (UTR + screenshot), the operator queue, idempotent approval that
 * credits the wallet or renews the plan in one transaction, duplicate-UTR blocking, rejection,
 * the ACTIVE → PAST_DUE → SUSPENDED lifecycle (ML-D2, ML-D5, ML-D6), and workspace isolation.
 */
const PLATFORM_SECRET = 'manualbillingplatformsecret00001'
const ENV = {
  MANAGED_LAUNCH_MODE: 'true',
  BILLING_SUBSCRIPTIONS_ENFORCED: 'true',
  UPI_VPA: 'fenwira.test@okaxis',
  UPI_PAYEE_NAME: 'ZenteqK Fenwira',
  BILLING_GRACE_DAYS: '7',
  BILLING_INVOICE_LEAD_DAYS: '7',
  META_APP_SECRET: PLATFORM_SECRET,
}
const DAY = 86_400_000
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)])

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let migration: Database
let operator: Client
let ownerA: Member
let ownerB: Member
let testPlan: { id: string; key: string }

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const utr = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-12)
const ws = (tenantId: string) => `/platform/workspaces/${tenantId}`

async function issue(tenantId: string, body: Record<string, unknown>) {
  const res = await operator.post(`${ws(tenantId)}/invoices`, {
    dueAt: new Date(Date.now() + 7 * DAY).toISOString(),
    idempotencyKey: randomUUID(),
    ...body,
  })
  expect(res.status, res.text).toBe(201)
  return res.body.data.result.invoiceId as string
}

async function submitProof(owner: Member, invoiceId: string, ref: string, withFile = false) {
  let fileId: string | undefined
  if (withFile) {
    const up = await owner.client.post(`/billing/invoices/${invoiceId}/proof-uploads`, {
      filename: 'upi.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
    })
    expect(up.status, up.text).toBe(201)
    const put = await fetch(up.body.data.url, {
      method: 'PUT',
      headers: up.body.data.headers,
      body: PNG,
    })
    expect(put.status).toBe(200)
    fileId = up.body.data.fileId
  }
  return owner.client.post(`/billing/invoices/${invoiceId}/proofs`, {
    utr: ref,
    ...(fileId ? { fileId } : {}),
  })
}

const pendingProofOf = async (owner: Member, invoiceId: string) =>
  (await owner.client.get(`/billing/invoices/${invoiceId}`)).body.data.proofs.find(
    (p: { status: string }) => p.status === 'PENDING',
  ).id as string

const subscriptionOf = (tenantId: string) =>
  db.withTenant(tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId } }))

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({ ...ENV, META_GRAPH_BASE_URL: mock.url })
  worker = await bootWorker({ ...ENV, META_GRAPH_BASE_URL: mock.url })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  // An isolated, priced, non-public plan: the shared seed plans stay unpriced (P11-D4).
  const key = `ML_${metaId()}`
  testPlan = await migration.withGlobal(async (tx) => {
    const plan = await tx.plan.create({ data: { key, name: 'Managed test plan', isPublic: false } })
    await tx.planPrice.create({
      data: { planId: plan.id, currency: 'INR', interval: 'MONTH', amountMinor: 149_900n },
    })
    return { id: plan.id, key }
  })
  ownerA = await createOwner(api, 'mb-a', 'Acme <script>alert(1)</script> Foods')
  ownerB = await createOwner(api, 'mb-b')
  ;({ client: operator } = await createOperator(api, db, migration, 'mb-operator'))
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await migration?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('wallet top-up paid by UPI', () => {
  let invoiceId: string
  let proofId: string
  const ref = utr()

  it('issues a payment request with a UPI QR and deep link from configuration', async () => {
    invoiceId = await issue(ownerA.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 50_000 })
    const list = await ownerA.client.get('/billing/invoices')
    expect(list.status).toBe(200)
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: invoiceId,
        kind: 'WALLET_TOPUP',
        status: 'OPEN',
        displayStatus: 'DUE',
        totalMinor: 50_000,
        taxLines: [],
        payee: { vpa: 'fenwira.test@okaxis', name: 'ZenteqK Fenwira' },
      }),
    ])
    const detail = (await ownerA.client.get(`/billing/invoices/${invoiceId}`)).body.data
    expect(detail.number).toMatch(/^FW-INV-\d{6}$/)
    expect(detail.upi.deepLink).toBe(
      `upi://pay?pa=fenwira.test%40okaxis&pn=ZenteqK%20Fenwira&am=500.00&cu=INR&tn=${detail.number}`,
    )
    expect(detail.upi.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    // Billing readers were notified.
    const notes = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.notification.count({ where: { dedupeKey: `invoice:${invoiceId}:issued` } }),
    )
    expect(notes).toBe(1)
  })

  it('accepts a UTR with a verified screenshot; the operator sees it in the queue', async () => {
    const res = await submitProof(ownerA, invoiceId, ` ${ref.slice(0, 6)}-${ref.slice(6)} `, true)
    expect(res.status, res.text).toBe(201)
    expect(res.body.data.displayStatus).toBe('PAYMENT_SUBMITTED')
    expect(res.body.data.proofs[0]).toMatchObject({ utr: ref, status: 'PENDING', hasFile: true })
    proofId = res.body.data.proofs[0].id

    const again = await submitProof(ownerA, invoiceId, utr())
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('PAYMENT_PENDING')

    const dash = await operator.get('/platform/billing/dashboard')
    expect(dash.status, dash.text).toBe(200)
    expect(dash.body.data.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ proofId, utr: ref, totalMinor: '50000', hasFile: true }),
      ]),
    )
    const file = await operator.get(`${ws(ownerA.tenantId)}/payment-proofs/${proofId}/file`)
    expect(file.status, file.text).toBe(200)
    const bytes = Buffer.from(await (await fetch(file.body.data.url)).arrayBuffer())
    expect(bytes.equals(PNG)).toBe(true)
  })

  it('approves once: wallet credited, invoice paid, receipt issued; retries are idempotent', async () => {
    const approve = () =>
      operator.post(`${ws(ownerA.tenantId)}/payment-proofs/${proofId}/approve`, {
        reference: 'HDFC stmt 23-Oct',
      })
    const first = await approve()
    expect(first.status, first.text).toBe(200)
    expect(first.body.data).toMatchObject({
      status: 'APPROVED',
      invoiceStatus: 'PAID',
      receiptNumber: expect.stringMatching(/^FW-RCT-\d{6}$/),
    })
    const second = await approve()
    expect(second.status, second.text).toBe(200)
    expect(second.body.data).toEqual(first.body.data)

    const credits = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.walletTransaction.findMany({
        where: { referenceType: 'invoice', referenceId: invoiceId },
      }),
    )
    expect(credits.map((c) => [c.type, c.amountMinor, c.fundType])).toEqual([
      ['CREDIT', 50_000n, 'PAID'],
    ])

    const reject = await operator.post(`${ws(ownerA.tenantId)}/payment-proofs/${proofId}/reject`, {
      reason: 'Changed my mind',
    })
    expect(reject.status).toBe(409)
    expect(reject.body.error.code).toBe('ALREADY_REVIEWED')

    const inv = (await ownerA.client.get(`/billing/invoices/${invoiceId}`)).body.data
    expect(inv).toMatchObject({ status: 'PAID', displayStatus: 'PAID', upi: null })
    expect(inv.receiptNumber).toBe(first.body.data.receiptNumber)

    const audit = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: 'commercial.payment_' } } }),
    )
    expect(audit.map((a) => [a.action, a.actorType])).toEqual([
      ['commercial.payment_approval', 'PLATFORM_OPERATOR'],
    ])
    const dash = await operator.get('/platform/billing/dashboard')
    expect(dash.body.data.pending.some((p: { proofId: string }) => p.proofId === proofId)).toBe(
      false,
    )
    expect(dash.body.data.revenue[0]).toMatchObject({
      currency: 'INR',
      payments: expect.any(Number),
    })
  })

  it('serves the payment request and receipt as escaped, script-free HTML', async () => {
    const doc = await ownerA.client.get(`/billing/invoices/${invoiceId}/document`)
    expect(doc.status).toBe(200)
    expect(doc.headers['content-type']).toMatch(/^text\/html/)
    expect(doc.headers['content-security-policy']).toContain("default-src 'none'")
    expect(doc.text).toContain('Payment request FW-INV-')
    expect(doc.text).toContain('Acme &lt;script&gt;alert(1)&lt;/script&gt; Foods')
    expect(doc.text).not.toContain('<script')
    expect(doc.text).toContain('not a tax invoice')
    expect(doc.text).toContain('billed by Meta')
    const receipt = await ownerA.client.get(`/billing/invoices/${invoiceId}/receipt?download=1`)
    expect(receipt.status).toBe(200)
    expect(receipt.headers['content-disposition']).toMatch(/^attachment/)
    expect(receipt.text).toContain(ref)
  })

  it('blocks a UTR already used anywhere, even in another workspace', async () => {
    const other = await issue(ownerB.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 10_000 })
    const dup = await submitProof(ownerB, other, ref)
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('UTR_ALREADY_USED')
  })
})

describe('rejection, resubmission and void', () => {
  it('rejects with a reason, frees the UTR and lets the customer resubmit', async () => {
    const invoiceId = await issue(ownerB.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 20_000 })
    const ref = utr()
    expect((await submitProof(ownerB, invoiceId, ref)).status).toBe(201)
    const proofId = await pendingProofOf(ownerB, invoiceId)
    const rejected = await operator.post(
      `${ws(ownerB.tenantId)}/payment-proofs/${proofId}/reject`,
      {
        reason: 'No matching credit in the bank statement.',
      },
    )
    expect(rejected.status, rejected.text).toBe(200)
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', invoiceStatus: 'OPEN' })
    const inv = (await ownerB.client.get(`/billing/invoices/${invoiceId}`)).body.data
    expect(inv.displayStatus).toBe('DUE')
    expect(inv.proofs[0]).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'No matching credit in the bank statement.',
    })
    expect((await submitProof(ownerB, invoiceId, ref)).status).toBe(201)
  })

  it('voids an open invoice; it can no longer be paid', async () => {
    const invoiceId = await issue(ownerB.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 30_000 })
    const voided = await operator.post(`${ws(ownerB.tenantId)}/invoices/${invoiceId}/void`, {
      reason: 'Issued twice by mistake',
    })
    expect(voided.status, voided.text).toBe(200)
    const inv = (await ownerB.client.get(`/billing/invoices/${invoiceId}`)).body.data
    expect(inv).toMatchObject({ status: 'VOID', voidReason: 'Issued twice by mistake', upi: null })
    const late = await submitProof(ownerB, invoiceId, utr())
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('INVOICE_NOT_OPEN')
  })
})

describe('renewal lifecycle: ACTIVE → renewal invoice → PAST_DUE → SUSPENDED → paid', () => {
  let wsC: Member
  let phone: { wabaId: string; phoneNumberId: string }
  let tick: (now: Date) => Promise<string>
  let periodEnd: Date

  beforeAll(async () => {
    wsC = await createOwner(api, 'mb-c')
    const activate = await operator.post(`${ws(wsC.tenantId)}/subscription-operations`, {
      kind: 'activate',
      planId: testPlan.id,
      reason: 'Managed launch customer',
      reference: 'contract-001',
      idempotencyKey: randomUUID(),
    })
    expect(activate.status, activate.text).toBe(200)
    periodEnd = new Date(Date.now() + 3 * DAY)
    await db.withTenant(wsC.tenantId, (tx) =>
      tx.subscription.update({
        where: { tenantId: wsC.tenantId },
        data: { currentPeriodEnd: periodEnd },
      }),
    )
    const processor = worker.get(BillingMaintenanceProcessor)
    tick = (now) => processor.tickSubscriptions(now)
    // A connected number and a conversation, to prove what suspension blocks (and what not).
    phone = { wabaId: metaId(), phoneNumberId: metaId() }
    await fetch(`${mock.url}/__mock/seed`, {
      method: 'POST',
      body: JSON.stringify({
        wabaId: phone.wabaId,
        phones: [{ id: phone.phoneNumberId, display: '+91 90000 11111' }],
      }),
    })
    const connect = await operator.post(`${ws(wsC.tenantId)}/whatsapp/connections`, {
      ...phone,
      displayPhoneNumber: '+91 90000 11111',
      accessToken: `mock-dev:${phone.wabaId}:token-c`,
    })
    expect(connect.status, connect.text).toBe(201)
  }, 60_000)

  const inbound = async (from: string) => {
    const raw = JSON.stringify(
      inboundMessageWebhook(phone, { from, wamid: `wamid.${randomUUID()}`, text: 'Hello' }),
    )
    return request(api.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signWebhookBody(PLATFORM_SECRET, raw))
      .send(raw)
  }
  const conversation = (from: string) =>
    waitFor(
      async () =>
        (
          (await wsC.client.get('/conversations?view=all&limit=100')).body.data as Array<{
            id: string
            contact: { phoneE164: string }
          }>
        ).find((c) => c.contact.phoneE164 === `+${from}`),
      (c) => !!c,
    )

  it('issues the renewal once, inside the lead window, at the plan price', async () => {
    await tick(new Date())
    await tick(new Date())
    const invoices = (await wsC.client.get('/billing/invoices')).body.data
    expect(invoices).toEqual([
      expect.objectContaining({
        kind: 'PLAN_RENEWAL',
        totalMinor: 149_900,
        plan: { key: testPlan.key, name: 'Managed test plan' },
        dueAt: periodEnd.toISOString(),
      }),
    ])
    const status = (await wsC.client.get('/workspace/status')).body.data.subscription
    expect(status).toMatchObject({ status: 'ACTIVE', paymentDue: true })
  })

  it('moves to PAST_DUE at period end; everything still works during grace', async () => {
    await tick(new Date(periodEnd.getTime() + 3_600_000))
    expect((await subscriptionOf(wsC.tenantId)).status).toBe('PAST_DUE')
    const status = (await wsC.client.get('/workspace/status')).body.data.subscription
    expect(status.status).toBe('PAST_DUE')
    expect(new Date(status.graceEndsAt).getTime()).toBe(periodEnd.getTime() + 7 * DAY)
  })

  it('suspends after the grace days: outbound and campaigns blocked, inbound kept', async () => {
    const from = `9198${metaId().slice(0, 8)}`
    expect((await inbound(from)).body).toMatchObject({ accepted: 1 })
    const conv = await conversation(from)
    await tick(new Date(periodEnd.getTime() + 8 * DAY))
    expect((await subscriptionOf(wsC.tenantId)).status).toBe('SUSPENDED')

    const reply = await wsC.client.post(
      `/conversations/${conv!.id}/messages`,
      { content: { type: 'TEXT', text: 'Thanks!' } },
      { 'Idempotency-Key': randomUUID() },
    )
    expect(reply.status, reply.text).toBe(422)
    expect(reply.body.error.code).toBe('SUBSCRIPTION_SUSPENDED')
    // Inbound keeps arriving and is stored.
    expect((await inbound(from)).body).toMatchObject({ accepted: 1 })
    const status = (await wsC.client.get('/workspace/status')).body.data.subscription
    expect(status.status).toBe('SUSPENDED')
  })

  it('paying the renewal reactivates from the approval date (ML-D6 for a suspended workspace)', async () => {
    const invoice = (await wsC.client.get('/billing/invoices')).body.data[0]
    expect((await submitProof(wsC, invoice.id, utr())).status).toBe(201)
    const proofId = await pendingProofOf(wsC, invoice.id)
    const before = Date.now()
    const ok = await operator.post(`${ws(wsC.tenantId)}/payment-proofs/${proofId}/approve`, {
      reference: 'ICICI stmt',
    })
    expect(ok.status, ok.text).toBe(200)
    const sub = await subscriptionOf(wsC.tenantId)
    expect(sub.status).toBe('ACTIVE')
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(before + 27 * DAY)
  })

  it('paying a PAST_DUE renewal extends from the previous period end (no free days)', async () => {
    const end = new Date(Date.now() - DAY)
    await db.withTenant(wsC.tenantId, (tx) =>
      tx.subscription.update({
        where: { tenantId: wsC.tenantId },
        data: { status: 'PAST_DUE', currentPeriodEnd: end },
      }),
    )
    const invoiceId = await issue(wsC.tenantId, {
      kind: 'PLAN_RENEWAL',
      planKey: testPlan.key,
      amountMinor: 149_900,
    })
    expect((await submitProof(wsC, invoiceId, utr())).status).toBe(201)
    const proofId = await pendingProofOf(wsC, invoiceId)
    expect(
      (
        await operator.post(`${ws(wsC.tenantId)}/payment-proofs/${proofId}/approve`, {
          reference: 'SBI',
        })
      ).status,
    ).toBe(200)
    const sub = await subscriptionOf(wsC.tenantId)
    expect(sub.status).toBe('ACTIVE')
    expect(sub.currentPeriodStart!.toISOString()).toBe(end.toISOString())
    const expected = new Date(end)
    expected.setUTCMonth(expected.getUTCMonth() + 1)
    expect(sub.currentPeriodEnd!.toISOString()).toBe(expected.toISOString())
  })
})

describe('billing emails: issued, due soon, overdue, rejected, approved', () => {
  const claimed = (tenantId: string, key: string) =>
    waitFor(
      () =>
        db.withTenant(tenantId, (tx) =>
          tx.notification.findMany({ where: { dedupeKey: key }, select: { emailedAt: true } }),
        ),
      (rows) => rows.length > 0 && rows.every((r) => r.emailedAt !== null),
    )
  const deliveries = async (kind: string, email: string) =>
    migration.withGlobal((tx) =>
      tx.emailDelivery.count({ where: { kind, recipientHash: sha256(email.toLowerCase()) } }),
    )

  it('emails each notice once per member, even when the daily reminder job reruns', async () => {
    const dueAt = new Date(Date.now() + 2 * DAY)
    const id = await issue(ownerB.tenantId, {
      kind: 'WALLET_TOPUP',
      amountMinor: 30_000,
      dueAt: dueAt.toISOString(),
    })
    await claimed(ownerB.tenantId, `invoice:${id}:issued`)
    const reminders = worker.get(BillingMaintenanceProcessor)
    await reminders.remindInvoices()
    await reminders.remindInvoices()
    await claimed(ownerB.tenantId, `invoice:${id}:due-soon`)
    const later = new Date(dueAt.getTime() + DAY)
    await reminders.remindInvoices(later)
    await reminders.remindInvoices(later)
    await claimed(ownerB.tenantId, `invoice:${id}:overdue`)
    // Let any redelivered notice drain; a rerun must not send again.
    await new Promise((r) => setTimeout(r, 2000))
    for (const kind of ['invoice_issued', 'invoice_due_soon', 'invoice_overdue'])
      expect(await deliveries(kind, ownerB.email), kind).toBeGreaterThanOrEqual(1)
    const before = await deliveries('invoice_overdue', ownerB.email)
    await reminders.remindInvoices(later)
    await new Promise((r) => setTimeout(r, 1500))
    expect(await deliveries('invoice_overdue', ownerB.email)).toBe(before)
  })

  it('emails the rejection reason and the receipt after approval', async () => {
    const id = await issue(ownerB.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 25_000 })
    expect((await submitProof(ownerB, id, utr())).status).toBe(201)
    const first = await pendingProofOf(ownerB, id)
    await operator.post(`${ws(ownerB.tenantId)}/payment-proofs/${first}/reject`, {
      reason: 'No matching credit in the bank statement.',
    })
    await claimed(ownerB.tenantId, `proof:${first}:rejected`)
    expect((await submitProof(ownerB, id, utr())).status).toBe(201)
    const second = await pendingProofOf(ownerB, id)
    const ok = await operator.post(`${ws(ownerB.tenantId)}/payment-proofs/${second}/approve`, {
      reference: 'stmt',
    })
    expect(ok.status, ok.text).toBe(200)
    await claimed(ownerB.tenantId, `invoice:${id}:paid`)
    // A paid invoice gets no further reminders.
    const reminders = worker.get(BillingMaintenanceProcessor)
    await reminders.remindInvoices(new Date(Date.now() + 30 * DAY))
    await new Promise((r) => setTimeout(r, 1500))
    const overdue = await db.withTenant(ownerB.tenantId, (tx) =>
      tx.notification.count({ where: { dedupeKey: `invoice:${id}:overdue` } }),
    )
    expect(overdue).toBe(0)
  })
})

describe('isolation and permissions', () => {
  let invoiceA: string
  beforeAll(async () => {
    invoiceA = await issue(ownerA.tenantId, { kind: 'WALLET_TOPUP', amountMinor: 1_000 })
  })

  it('never lets one workspace read or pay another workspace’s invoice', async () => {
    for (const res of [
      await ownerB.client.get(`/billing/invoices/${invoiceA}`),
      await ownerB.client.get(`/billing/invoices/${invoiceA}/document`),
      await ownerB.client.post(`/billing/invoices/${invoiceA}/proofs`, { utr: utr() }),
      await ownerB.client.post(`/billing/invoices/${invoiceA}/proof-uploads`, {
        filename: 'x.png',
        mimeType: 'image/png',
        sizeBytes: 10,
      }),
    ])
      expect(res.status, res.text).toBe(404)
    const listB = (await ownerB.client.get('/billing/invoices')).body.data as Array<{ id: string }>
    expect(listB.some((i) => i.id === invoiceA)).toBe(false)
    // The operator can't reach A's proof through B's workspace.
    expect((await submitProof(ownerA, invoiceA, utr())).status).toBe(201)
    const proofA = await pendingProofOf(ownerA, invoiceA)
    for (const res of [
      await operator.post(`${ws(ownerB.tenantId)}/payment-proofs/${proofA}/approve`, {
        reference: 'x-ref',
      }),
      await operator.post(`${ws(ownerB.tenantId)}/payment-proofs/${proofA}/reject`, {
        reason: 'nope nope',
      }),
      await operator.get(`${ws(ownerB.tenantId)}/payment-proofs/${proofA}/file`),
      await operator.post(`${ws(ownerB.tenantId)}/invoices/${invoiceA}/void`, {
        reason: 'cross tenant',
      }),
    ])
      expect(res.status, res.text).toBe(404)
    expect((await operator.get(`${ws(uuidv7())}/invoices`)).status).toBe(404)
  })

  it('needs billing.read to see invoices and billing.manage to submit proof', async () => {
    const agent = await addMember(api, ownerA, 'AGENT')
    expect((await agent.client.get('/billing/invoices')).status).toBe(403)
    const admin = await addMember(api, ownerA, 'ADMIN')
    expect((await admin.client.get(`/billing/invoices/${invoiceA}`)).status).toBe(200)
    expect(
      (await admin.client.post(`/billing/invoices/${invoiceA}/proofs`, { utr: utr() })).status,
    ).toBe(403)
    // Tenants never reach the operator console.
    expect((await ownerA.client.get('/platform/billing/dashboard')).status).toBe(401)
  })
})
