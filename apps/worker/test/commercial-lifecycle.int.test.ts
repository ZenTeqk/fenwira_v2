import { AnalyticsRollupProcessor } from '@fenwira/api/modules/analytics'
import {
  BillingMaintenanceProcessor,
  ledgerFigures,
  stepSubscription,
} from '@fenwira/api/modules/billing'
import { MessagingService } from '@fenwira/api/modules/messaging'
import {
  IDENTITY_OPTIONS,
  type IdentityOptions,
  PasswordService,
  totpAt,
} from '@fenwira/api/modules/identity'
import { WebhookEventsProcessor, verifyWebhookSignature } from '@fenwira/api/modules/webhooks'
import { encryptSecret, uuidv7 } from '@fenwira/config'
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import {
  startMetaMock,
  deliverWebhook,
  inboundMessageWebhook,
  statusWebhook,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { bootApi, bootWorker, Client, PASSWORD, uniqueEmail } from './support/harness'
import {
  campaignWorld,
  draftCampaign,
  launch,
  campaignOf,
  seedContacts,
  metaId,
  phoneNo,
  waitFor,
} from './support/campaigns'
import { addMember, createOwner } from './support/workspace'
import { chain, createFlow, keyword, executions, executionsWhere } from './support/automation'

// Both switches are isolated to these app instances. No .env/default/real-user rollout changes.
const ENV = {
  BILLING_ENFORCED: 'true',
  BILLING_SUBSCRIPTIONS_ENFORCED: 'true',
  AUTOMATION_WEBHOOK_DEV_HOSTS: '127.0.0.1',
  ANALYTICS_SETTLE_SECONDS: '0',
}
const META_SECRET = 'closure-local-meta-secret'
let api: INestApplication, worker: INestApplication, db: Database, migration: Database
let mock: Awaited<ReturnType<typeof startMetaMock>>,
  receiver: Server,
  receiverUrl: string,
  inboundUrl: string
let operator: Client, operatorId: string
const received: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> = []
const base = () => ({
  reason: 'Phase 11 isolated closure verification',
  reference: 'closure-test',
  idempotencyKey: uuidv7(),
})

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    ...ENV,
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: META_SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  inboundUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = {
    url: inboundUrl,
    appSecret: META_SECRET,
    statuses: ['sent', 'delivered'],
    delayMs: 20,
  }
  worker = await bootWorker({
    ...ENV,
    META_GRAPH_BASE_URL: mock.url,
    WHATSAPP_OUTBOUND_BACKOFF_MS: '20',
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 8 })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  receiver = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      received.push({ body, headers: req.headers })
      res.writeHead(200).end('ok')
    })
  })
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r))
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`
  operatorId = uuidv7()
  const email = uniqueEmail('closure-operator'),
    secret = 'JBSWY3DPEHPK3PXP'
  const options = api.get<IdentityOptions>(IDENTITY_OPTIONS)
  await db.withGlobal(async (tx) => {
    await tx.user.create({
      data: {
        id: operatorId,
        email,
        name: 'Closure operator',
        emailVerifiedAt: new Date(),
        passwordHash: await api.get(PasswordService).hash(PASSWORD),
      },
    })
    await tx.twoFactorCredential.create({
      data: {
        userId: operatorId,
        secretCiphertext: encryptSecret(options.keyRing, secret),
        enabledAt: new Date(),
      },
    })
  })
  await migration.withGlobal((tx) =>
    tx.platformGrant.create({
      data: { userId: operatorId, reason: 'isolated test fixture', grantedBy: 'test' },
    }),
  )
  operator = new Client(api)
  const login = await operator.post('/platform/auth/login', { email, password: PASSWORD })
  expect(login.status).toBe(200)
  const verified = await operator.post('/platform/auth/verify', {
    challengeToken: login.body.data.challengeToken,
    code: totpAt(secret, Math.floor(Date.now() / 30_000)),
  })
  expect(verified.status).toBe(200)
  operator.csrf = verified.body.data.csrfToken
}, 60_000)
afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await migration?.disconnect()
  await new Promise<void>((r) => receiver?.close(() => r()))
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

it('trial → operator funding → campaign/automation usage → expiry → operator activation → overrides/refund → cancellation reconciles', async () => {
  const w = await campaignWorld(api, mock.url, 'closure-lifecycle'),
    t = w.owner.tenantId
  const path = `/platform/workspaces/${t}`
  await Promise.all(Array.from({ length: 8 }, () => w.owner.client.get('/billing/entitlements')))
  const trial = await db.withTenant(t, async (tx) => ({
    subscription: await tx.subscription.findUniqueOrThrow({ where: { tenantId: t } }),
    tenant: await tx.tenant.findUniqueOrThrow({ where: { id: t } }),
    count: await tx.subscription.count(),
  }))
  expect(trial.count).toBe(1)
  expect(trial.subscription.status).toBe('TRIALING')
  expect(trial.subscription.planId).toBeNull()
  expect(trial.subscription.trialEndsAt!.getTime() - trial.tenant.createdAt.getTime()).toBe(
    14 * 86_400_000,
  )
  expect(trial.tenant.billingMode).toBe('TRIAL')
  const ents = (await w.owner.client.get('/billing/entitlements')).body.data
  expect(ents.find((e: { key: string }) => e.key === 'max_contacts').limit).toBe(25000)
  const key = await w.owner.client.post('/api-keys', {
    name: 'lifecycle',
    scopes: ['contacts.read'],
  })
  expect(key.status).toBe(201)
  const token = key.body.data.secret as string
  const call = () =>
    w.owner.client.agent
      .post('/api/v1/contacts/search')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
  expect((await call()).status).toBe(200)
  const ep = await w.owner.client.post('/webhook-endpoints', {
    name: 'closure receiver',
    url: receiverUrl,
    events: ['contact.created'],
  })
  expect(ep.status).toBe(201)
  const endpointId = ep.body.data.endpoint.id as string,
    webhookSecret = ep.body.data.secret as string
  const command = { ...base(), kind: 'paid_credit', amountMinor: 1000, currency: 'INR' }
  const credits = await Promise.all(
    Array.from({ length: 6 }, () => operator.post(`${path}/wallet-operations`, command)),
  )
  expect(credits.every((r) => r.status === 200)).toBe(true)
  expect(new Set(credits.map((r) => r.body.data.id)).size).toBe(1)
  const promo = await operator.post(`${path}/wallet-operations`, {
    ...base(),
    kind: 'promotional_credit',
    amountMinor: 100,
    currency: 'INR',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  })
  expect(promo.status).toBe(200)
  const contact = await w.owner.client.post('/contacts', {
    phone: phoneNo(),
    name: 'Closure customer',
  })
  expect(contact.status).toBe(201)
  const hit = await waitFor(
    async () => received.find((r) => JSON.parse(r.body).data.contactId === contact.body.data.id),
    (v) => !!v,
  )
  expect(
    verifyWebhookSignature(
      webhookSecret,
      hit!.headers[WEBHOOK_TIMESTAMP_HEADER.toLowerCase()] as string,
      hit!.body,
      hit!.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()] as string,
    ),
  ).toBe(true)
  const { tagId } = await seedContacts(db, t, `closure-${metaId()}`, [
    { utility: 'GRANTED' },
    { utility: 'GRANTED' },
  ])
  const campaign = await draftCampaign(w, tagId)
  expect((await launch(w, campaign.id)).status).toBe(200)
  await waitFor(
    () => campaignOf(w, campaign.id),
    (c) => c.status === 'COMPLETED',
  )
  const template = await db.withTenant(t, (tx) =>
    tx.template.findFirstOrThrow({ where: { name: 'order_update' } }),
  )
  const flow = await createFlow(
    w.owner,
    'Closure automation',
    chain(keyword('closure'), {
      id: 'send',
      type: 'action.send_template',
      config: {
        templateId: template.id,
        variables: { body: ['{{contact.firstName}}', '#closure'] },
      },
    }),
  )
  const inbound = async (word: string) => {
    const from = phoneNo().slice(1)
    expect(
      await deliverWebhook(
        inboundUrl,
        META_SECRET,
        inboundMessageWebhook(w.ids, {
          from,
          wamid: `wamid.${metaId()}`,
          text: word,
          name: 'Local customer',
        }),
      ),
    ).toBe(200)
    await waitFor(
      () =>
        db.withTenant(t, (tx) =>
          tx.message.count({ where: { direction: 'INBOUND', contact: { phoneE164: `+${from}` } } }),
        ),
      (n) => n === 1,
    )
  }
  await inbound('closure')
  await executionsWhere(w.owner, flow, (e) => e.status === 'COMPLETED')
  await waitFor(
    () => db.withTenant(t, (tx) => tx.usageEvent.count()),
    (n) => n === 3,
  )
  await waitFor(
    () => db.withTenant(t, (tx) => tx.walletReservation.count({ where: { status: 'ACTIVE' } })),
    (n) => n === 0,
  )
  await worker.get(AnalyticsRollupProcessor).rollupTenant(t)
  const usage = await w.owner.client.get('/analytics/usage')
  expect(usage.status).toBe(200)
  expect(usage.body.kpis.chargeMinor.value).toBe(39)
  expect(usage.body.kpis.billableMessages.value).toBe(3)
  expect(JSON.stringify(usage.body)).not.toMatch(/providerCost|provider_cost|secretCiphertext/)
  const send = () =>
    worker.get(MessagingService).send({
      tenantId: t,
      target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
      content: {
        type: 'TEMPLATE',
        templateVersionId: w.utility.versionId,
        variables: { body: ['Test', '#1'] },
      },
      source: 'API',
      idempotencyKey: uuidv7(),
    })
  await db.withTenant(t, (tx) =>
    tx.subscription.update({
      where: { tenantId: t },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    }),
  )
  await worker.get(BillingMaintenanceProcessor).tickSubscriptions()
  await worker.get(BillingMaintenanceProcessor).tickSubscriptions()
  expect((await w.owner.client.get('/billing/subscription')).body.data.status).toBe('EXPIRED')
  expect((await call()).status).toBe(403)
  await expect(send()).rejects.toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' })
  await inbound('expired inbound')
  await inbound('closure')
  await waitFor(
    () => executions(w.owner, flow),
    (list) =>
      list.length === 2 &&
      list.some((e) => e.status === 'FAILED' && e.errorCode === 'SUBSCRIPTION_INACTIVE'),
  )
  const prior = await db.withTenant(t, (tx) =>
    tx.message.findFirstOrThrow({
      where: { direction: 'OUTBOUND', providerMessageId: { not: null } },
    }),
  )
  expect(
    await deliverWebhook(
      inboundUrl,
      META_SECRET,
      statusWebhook(w.ids, {
        wamid: prior.providerMessageId!,
        status: 'read',
        pricing: { billable: true, category: 'utility' },
      }),
    ),
  ).toBe(200)
  await waitFor(
    () => db.withTenant(t, (tx) => tx.message.findUniqueOrThrow({ where: { id: prior.id } })),
    (m) => m.status === 'READ',
  )
  expect(await db.withTenant(t, (tx) => tx.usageEvent.count())).toBe(3)

  expect((await w.owner.client.get('/api-keys')).body.data).toHaveLength(1)
  expect((await w.owner.client.get('/webhook-endpoints')).body.data[0]).toMatchObject({
    id: endpointId,
    status: 'ACTIVE',
  })
  const plans = (await w.owner.client.get('/billing/plans')).body.data as Array<{
    id: string
    key: string
  }>
  const growth = plans.find((p) => p.key === 'GROWTH')!.id
  expect(
    (await w.owner.client.post('/billing/subscription/request', { planId: growth })).status,
  ).toBe(200)
  expect((await w.owner.client.get('/billing/subscription')).body.data.status).toBe('EXPIRED')
  const activate = { ...base(), kind: 'activate', planId: growth }
  const activations = await Promise.all(
    Array.from({ length: 4 }, () => operator.post(`${path}/subscription-operations`, activate)),
  )
  expect(activations.every((r) => r.status === 200)).toBe(true)
  expect(new Set(activations.map((r) => r.body.data.id)).size).toBe(1)
  expect((await call()).status).toBe(200) // original key, no replacement
  expect(
    (
      await operator.post(`${path}/subscription-operations`, {
        ...base(),
        kind: 'billing_mode',
        mode: 'PREPAID',
      })
    ).status,
  ).toBe(200)
  const balance = await db.withTenant(t, (tx) =>
    tx.wallet.findUniqueOrThrow({ where: { tenantId: t } }),
  )
  expect(balance.balanceMinor).toBe(1061n) // activation/mode did not fund wallet
  const override = {
    ...base(),
    kind: 'override_set',
    key: 'api_enabled',
    value: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }
  const overrides = await Promise.all(
    Array.from({ length: 4 }, () => operator.post(`${path}/entitlement-operations`, override)),
  )
  expect(overrides.every((r) => r.status === 200)).toBe(true)
  expect(new Set(overrides.map((r) => r.body.data.id)).size).toBe(1)
  expect((await call()).status).toBe(403)
  expect(
    (
      await operator.post(`${path}/entitlement-operations`, {
        ...base(),
        kind: 'override_remove',
        key: 'api_enabled',
      })
    ).status,
  ).toBe(200)
  expect((await call()).status).toBe(200)
  const debits = await db.withTenant(t, (tx) =>
    tx.walletTransaction.findMany({ where: { type: 'DEBIT' } }),
  )
  for (const amountMinor of [5, 8])
    expect(
      (
        await operator.post(`${path}/wallet-operations`, {
          ...base(),
          kind: 'refund',
          debitId: debits[0]!.id,
          amountMinor,
          currency: 'INR',
        })
      ).status,
    ).toBe(200)
  expect(
    (
      await operator.post(`${path}/wallet-operations`, {
        ...base(),
        kind: 'refund',
        debitId: debits[0]!.id,
        amountMinor: 1,
        currency: 'INR',
      })
    ).status,
  ).toBe(422)
  expect(
    (
      await operator.post(`${path}/wallet-operations`, {
        ...base(),
        kind: 'refund',
        debitId: debits[1]!.id,
        amountMinor: 13,
        currency: 'INR',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await operator.post(`${path}/wallet-operations`, {
        ...base(),
        kind: 'adjustment',
        amountMinor: -100,
        currency: 'INR',
      })
    ).status,
  ).toBe(200)
  await db.withTenant(t, async (tx) => {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { tenantId: t } })
    const figures = await ledgerFigures(tx, wallet.id)
    expect(figures.balanceMinor).toBe(1000n + 100n - 39n + 26n - 100n)
    expect(figures.balanceMinor).toBe(figures.ledgerMinor)
    expect(figures.reservedMinor).toBe(figures.activeHoldsMinor)
    expect(figures.reservedMinor).toBe(0n)
    const receipts = await tx.commercialOperation.findMany()
    expect(receipts).toHaveLength(10)
    expect(
      receipts.every(
        (r) => r.operatorId === operatorId && r.tenantId === t && !!r.reason && !!r.reference,
      ),
    ).toBe(true)
    expect(
      await tx.outboxEvent.count({ where: { eventType: 'commercial.operation_completed' } }),
    ).toBe(receipts.length)
    expect(await tx.walletTransaction.count({ where: { type: 'DEBIT' } })).toBe(3)
    expect(await tx.apiKey.count()).toBe(1)
  })
  expect(await db.withUser(operatorId, (tx) => tx.membership.count())).toBe(0)
  expect(
    (await operator.post(`${path}/subscription-operations`, { ...base(), kind: 'cancel' })).status,
  ).toBe(200)
  await db.withTenant(t, (tx) =>
    tx.subscription.update({
      where: { tenantId: t },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    }),
  )
  await worker.get(BillingMaintenanceProcessor).tickSubscriptions()
  expect((await w.owner.client.get('/billing/subscription')).body.data.status).toBe('CANCELLED')
  await expect(send()).rejects.toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' })
  await inbound('cancelled inbound')
  expect((await call()).status).toBe(403)
}, 120_000)

it('concurrent lifecycle scheduler steps produce one notice and one state transition', async () => {
  const owner = await createOwner(api, 'closure-notice-race'),
    t = owner.tenantId
  await owner.client.get('/billing/subscription')
  const at = new Date()
  await db.withTenant(t, (tx) =>
    tx.subscription.update({
      where: { tenantId: t },
      data: { trialEndsAt: new Date(at.getTime() + 2 * 86400000) },
    }),
  )
  for (const now of [
    at,
    new Date(at.getTime() + 1.5 * 86400000),
    new Date(at.getTime() + 3 * 86400000),
  ]) {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.withTenant(t, (tx) => stepSubscription(tx, t, now))),
    )
    expect(results.filter((r) => r.notice)).toHaveLength(1)
  }
  const state = await db.withTenant(t, async (tx) => ({
    sub: await tx.subscription.findUniqueOrThrow({ where: { tenantId: t } }),
    notices: await tx.notification.count({ where: { type: 'subscription.lifecycle' } }),
    transitions: await tx.auditLog.count({ where: { action: 'subscription.expired' } }),
  }))
  expect(state.sub.noticesSent).toEqual(['T-3', 'T-1'])
  expect(state.sub.status).toBe('EXPIRED')
  expect(state.notices).toBe(3)
  expect(state.transitions).toBe(1)
})

it('pending webhook suspension preserves endpoint failure count and resumes only via explicit retry/new events', async () => {
  const owner = await createOwner(api, 'closure-webhook-retry'),
    t = owner.tenantId
  const created = await owner.client.post('/webhook-endpoints', {
    name: 'pending retry',
    url: receiverUrl,
    events: ['contact.created'],
  })
  expect(created.status).toBe(201)
  const endpointId = created.body.data.endpoint.id as string
  const eventId = uuidv7()
  const delivery = await db.withTenant(t, (tx) =>
    tx.webhookDelivery.create({
      data: {
        tenantId: t,
        endpointId,
        eventId,
        eventType: 'contact.created',
        payload: {
          id: uuidv7(),
          type: 'contact.created',
          createdAt: new Date().toISOString(),
          eventId,
          data: { contactId: uuidv7(), source: 'MANUAL' },
        },
      },
    }),
  )
  const set = { ...base(), kind: 'override_set', key: 'webhooks_enabled', value: false }
  expect(
    (await operator.post(`/platform/workspaces/${t}/entitlement-operations`, set)).status,
  ).toBe(200)
  const processor = worker.get(WebhookEventsProcessor)
  expect(await processor.send({ tenantId: t, deliveryId: delivery.id })).toBe('suspended')
  const suspended = await db.withTenant(t, async (tx) => ({
    endpoint: await tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } }),
    delivery: await tx.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
  }))
  expect(suspended.endpoint.status).toBe('ACTIVE')
  expect(suspended.endpoint.failureCount).toBe(0)
  expect(suspended.delivery.errorCode).toBe('SUSPENDED_BY_PLAN')
  expect(suspended.delivery.nextAttemptAt).toBeNull()
  expect(
    (
      await operator.post(`/platform/workspaces/${t}/entitlement-operations`, {
        ...base(),
        kind: 'override_remove',
        key: 'webhooks_enabled',
      })
    ).status,
  ).toBe(200)
  expect(
    (await owner.client.post(`/webhook-endpoints/${endpointId}/deliveries/${delivery.id}/retry`))
      .status,
  ).toBe(204)
  await waitFor(
    () =>
      db.withTenant(t, (tx) =>
        tx.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ),
    (d) => d.status === 'SUCCEEDED',
  )
  expect(
    await db.withTenant(t, (tx) => tx.webhookDelivery.count({ where: { endpointId, eventId } })),
  ).toBe(1)
})

it('all tenant roles are denied platform privilege and financial tenant responses exclude provider cost', async () => {
  const owner = await createOwner(api, 'closure-roles')
  const members = [owner]
  for (const role of ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const)
    members.push(await addMember(api, owner, role, `closure-${role}`))
  for (const member of members) {
    expect((await member.client.get('/platform/auth/me')).status).toBe(401)
    expect((await member.client.get(`/platform/workspaces/${owner.tenantId}`)).status).toBe(401)
    expect(
      (
        await member.client.post('/platform/auth/login', {
          email: member.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(401)
  }
  for (const path of [
    '/billing/wallet',
    '/billing/wallet/transactions',
    '/billing/subscription',
    '/billing/entitlements',
    '/analytics/overview',
    '/analytics/usage',
  ]) {
    const res = await owner.client.get(path)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toMatch(
      /providerCost|provider_cost|markupBps|markup_bps|secretCiphertext/,
    )
  }
  const csv = await owner.client.post('/billing/wallet/transactions/export')
  expect(csv.status).toBe(200)
  expect(csv.text).not.toMatch(/providerCost|provider_cost|markupBps|markup_bps/)
}, 60_000)

it('PREPAID active subscription does not fund wallet; empty wallet refuses and funded wallet settles', async () => {
  const w = await campaignWorld(api, mock.url, 'closure-prepaid'),
    t = w.owner.tenantId
  const path = `/platform/workspaces/${t}`
  const plans = (await w.owner.client.get('/billing/plans')).body.data as Array<{
    id: string
    key: string
  }>
  expect(
    (
      await operator.post(`${path}/subscription-operations`, {
        ...base(),
        kind: 'activate',
        planId: plans.find((p) => p.key === 'GROWTH')!.id,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await operator.post(`${path}/subscription-operations`, {
        ...base(),
        kind: 'billing_mode',
        mode: 'PREPAID',
      })
    ).status,
  ).toBe(200)
  expect((await w.owner.client.get('/billing/wallet')).body.data.balanceMinor).toBe(0)
  const send = () =>
    worker.get(MessagingService).send({
      tenantId: t,
      target: { phoneE164: phoneNo(), phoneNumberId: w.phoneId },
      content: {
        type: 'TEMPLATE',
        templateVersionId: w.utility.versionId,
        variables: { body: ['Local', '#1'] },
      },
      source: 'API',
      idempotencyKey: uuidv7(),
    })
  await expect(send()).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
  expect(
    (
      await operator.post(`${path}/wallet-operations`, {
        ...base(),
        kind: 'paid_credit',
        amountMinor: 13,
        currency: 'INR',
      })
    ).status,
  ).toBe(200)
  const accepted = await send()
  await waitFor(
    () =>
      db.withTenant(t, (tx) =>
        tx.walletReservation.findFirst({ where: { messageId: accepted.id } }),
      ),
    (r) => r?.status === 'SETTLED',
  )
  expect((await w.owner.client.get('/billing/wallet')).body.data.balanceMinor).toBe(0)
  await expect(send()).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
  expect(
    await db.withTenant(t, (tx) =>
      tx.walletTransaction.count({ where: { type: 'DEBIT', referenceId: accepted.id } }),
    ),
  ).toBe(1)
}, 60_000)

it('configured downgrade below contacts/users/flows keeps data and active flows; inbound survives and upgrade restores growth', async () => {
  const w = await campaignWorld(api, mock.url, 'closure-downgrade'),
    t = w.owner.tenantId
  const path = `/platform/workspaces/${t}`
  const plans = (await w.owner.client.get('/billing/plans')).body.data as Array<{
    id: string
    key: string
  }>
  for (let i = 0; i < 3; i++) await addMember(api, w.owner, 'AGENT', `closure-member-${i}`)
  // Bounded fixture transactions avoid coupling setup to the interactive transaction timeout.
  for (let offset = 0; offset < 5001; offset += 500)
    await db.withTenant(t, (tx) =>
      tx.contact.createMany({
        data: Array.from({ length: Math.min(500, 5001 - offset) }, (_, i) => ({
          tenantId: t,
          phoneE164: `+9188${String(offset + i).padStart(8, '0')}`,
          source: 'MANUAL',
        })),
      }),
    )
  const flows: string[] = []
  for (let i = 0; i < 6; i++)
    flows.push(await createFlow(w.owner, `Downgrade ${i}`, chain(keyword(`limit${i}`))))
  expect(
    (
      await operator.post(`${path}/subscription-operations`, {
        ...base(),
        kind: 'activate',
        planId: plans.find((p) => p.key === 'STARTER')!.id,
      })
    ).status,
  ).toBe(200)
  const entitlements = (await w.owner.client.get('/billing/entitlements')).body.data as Array<{
    key: string
    overLimit: boolean
  }>
  for (const key of ['max_contacts', 'max_users', 'max_active_flows'])
    expect(entitlements.find((e) => e.key === key)?.overLimit).toBe(true)
  expect((await w.owner.client.post('/contacts', { phone: phoneNo() })).status).toBe(422)
  expect(
    (
      await w.owner.client.post('/team/invitations', {
        email: uniqueEmail('over-limit'),
        role: 'AGENT',
      })
    ).status,
  ).toBe(422)
  const data = await db.withTenant(t, async (tx) => ({
    contacts: await tx.contact.count(),
    members: await tx.membership.count({ where: { status: 'ACTIVE' } }),
    flows: await tx.flow.count({ where: { id: { in: flows }, status: 'ACTIVE' } }),
  }))
  expect(data).toEqual({ contacts: 5001, members: 4, flows: 6 })
  const from = phoneNo().slice(1)
  expect(
    await deliverWebhook(
      inboundUrl,
      META_SECRET,
      inboundMessageWebhook(w.ids, {
        from,
        wamid: `wamid.${metaId()}`,
        text: 'inbound over limit',
        name: 'Local',
      }),
    ),
  ).toBe(200)
  await waitFor(
    () => db.withTenant(t, (tx) => tx.contact.count()),
    (n) => n === 5002,
  )
  expect(
    (
      await operator.post(`${path}/subscription-operations`, {
        ...base(),
        kind: 'activate',
        planId: plans.find((p) => p.key === 'BUSINESS')!.id,
      })
    ).status,
  ).toBe(200)
  expect((await w.owner.client.post('/contacts', { phone: phoneNo() })).status).toBe(201)
  const restored = (await w.owner.client.get('/billing/entitlements')).body.data as Array<{
    key: string
    limit: number | null
    overLimit: boolean
  }>
  expect(restored.find((e) => e.key === 'analytics_retention')!.limit).toBe(365)
  for (const key of ['max_contacts', 'max_users', 'max_active_flows'])
    expect(restored.find((e) => e.key === key)?.overLimit).toBe(false)
}, 90_000)
