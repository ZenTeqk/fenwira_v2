import { NotificationsDispatchProcessor } from '@fenwira/api/modules/notifications'
import { commercialOperation, commercialJson } from '@fenwira/api/modules/platform-operations'
import {
  activatePlan,
  reserveForMessage,
  releaseReservation,
  postTransaction,
} from '@fenwira/api/modules/billing'
import { encryptSecret, uuidv7 } from '@fenwira/config'
import {
  IDENTITY_OPTIONS,
  type IdentityOptions,
  PasswordService,
  totpAt,
} from '@fenwira/api/modules/identity'
import { Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { bootApi, Client, PASSWORD, uniqueEmail } from './support/harness'

let app: INestApplication, db: Database, owner: Database
const SECRET = 'JBSWY3DPEHPK3PXP'
const code = () => totpAt(SECRET, Math.floor(Date.now() / 30_000))
async function identity(operator = true, mfa = true) {
  const id = uuidv7(),
    email = uniqueEmail('platform')
  const options = app.get<IdentityOptions>(IDENTITY_OPTIONS)
  await db.withGlobal(async (tx) => {
    await tx.user.create({
      data: {
        id,
        email,
        name: 'Commercial operator',
        emailVerifiedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
      },
    })
    if (mfa)
      await tx.twoFactorCredential.create({
        data: {
          userId: id,
          secretCiphertext: encryptSecret(options.keyRing, SECRET),
          enabledAt: new Date(),
        },
      })
  })
  if (operator)
    await owner.withGlobal((tx) =>
      tx.platformGrant.create({ data: { userId: id, reason: 'fixture', grantedBy: 'fixture' } }),
    )
  return { id, email, client: new Client(app) }
}
async function privileged() {
  const user = await identity()
  const login = await user.client.post('/platform/auth/login', {
    email: user.email,
    password: PASSWORD,
  })
  expect(login.status).toBe(200)
  const res = await user.client.post('/platform/auth/verify', {
    challengeToken: login.body.data.challengeToken,
    code: code(),
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  user.client.csrf = res.body.data.csrfToken
  return user
}
beforeAll(async () => {
  app = await bootApi()
  db = Database.connect({ url: process.env.DATABASE_URL! })
  owner = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
})
afterAll(async () => {
  await app?.close()
  await db?.disconnect()
  await owner?.disconnect()
})
it('tenant identity and OWNER membership never confer operator access', async () => {
  const user = await identity(false, false)
  await user.client.login(user.email)
  const tenantId = uuidv7()
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Tenant', slug: tenantId },
    })
    await tx.membership.create({ data: { tenantId, userId: user.id, role: 'OWNER' } })
  })
  user.client.tenantId = tenantId
  expect((await user.client.get('/platform/auth/me')).status).toBe(401)
  expect(
    (await user.client.post('/platform/auth/login', { email: user.email, password: PASSWORD }))
      .status,
  ).toBe(401)
  const key = await user.client.post('/api-keys', { name: 'key', scopes: ['contacts.read'] })
  expect(key.status).toBe(201)
  expect(
    (
      await user.client.get('/platform/auth/me', {
        Authorization: `Bearer ${key.body.data.secret}`,
      })
    ).status,
  ).toBe(404)
})
it('requires enrolled MFA; password alone and tenant MFA challenges cannot establish privilege', async () => {
  const user = await identity(true, false)
  expect(
    (await user.client.post('/platform/auth/login', { email: user.email, password: PASSWORD }))
      .status,
  ).toBe(401)
  expect(
    (
      await user.client.post('/platform/auth/verify', {
        challengeToken: 'x'.repeat(32),
        code: code(),
      })
    ).status,
  ).toBe(401)
})
it('operator needs no customer membership; session and CSRF are distinct and logout revokes', async () => {
  const user = await privileged()
  const me = await user.client.get('/platform/auth/me')
  expect(me.status).toBe(200)
  expect(me.body.data.operatorId).toBe(user.id)
  expect(await db.withUser(user.id, (tx) => tx.membership.count())).toBe(0)
  expect(
    (await user.client.post('/platform/auth/logout', {}, { 'X-CSRF-Token': 'incorrect' })).status,
  ).toBe(403)
  expect((await user.client.post('/platform/auth/logout')).status).toBe(204)
  expect((await user.client.get('/platform/auth/me')).status).toBe(401)
})
it('MFA/challenge concurrent replay issues at most one privileged session', async () => {
  const user = await identity()
  const login = await user.client.post('/platform/auth/login', {
    email: user.email,
    password: PASSWORD,
  })
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      user.client.post('/platform/auth/verify', {
        challengeToken: login.body.data.challengeToken,
        code: code(),
      }),
    ),
  )
  expect(results.filter((r) => r.status === 200)).toHaveLength(1)
  expect(
    await db.withGlobal((tx) => tx.platformSession.count({ where: { userId: user.id } })),
  ).toBe(1)
})
it('revocation, idle expiration, backing session revocation and absolute expiry fail closed', async () => {
  for (const kind of ['grant', 'idle', 'parent', 'absolute']) {
    const user = await privileged()
    if (kind === 'grant')
      await owner.withGlobal((tx) =>
        tx.platformGrant.update({
          where: { userId: user.id },
          data: { version: { increment: 1 } },
        }),
      )
    if (kind === 'idle')
      await db.withGlobal((tx) =>
        tx.platformSession.updateMany({
          where: { userId: user.id },
          data: { lastUsedAt: new Date(Date.now() - 11 * 60_000) },
        }),
      )
    if (kind === 'absolute')
      await db.withGlobal((tx) =>
        tx.platformSession.updateMany({
          where: { userId: user.id },
          data: { expiresAt: new Date(0) },
        }),
      )
    if (kind === 'parent')
      await db.withGlobal((tx) =>
        tx.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
      )
    expect([401, 403]).toContain((await user.client.get('/platform/auth/me')).status)
  }
})

it('immutable financial receipts serialize identical retries and roll back changes when audit fails', async () => {
  const user = await identity()
  const tenantId = uuidv7()
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Financial receipt', slug: tenantId },
    })
    await tx.wallet.create({ data: { tenantId } })
  })
  const input = {
    kind: 'paid_credit',
    reason: 'Bank transfer',
    reference: 'test-ref',
    idempotencyKey: uuidv7(),
    amountMinor: 100,
    currency: 'INR',
  }
  const execute = (change = input) =>
    db.withTenant(tenantId, (tx) =>
      commercialOperation(
        tx,
        tenantId,
        user.id,
        change,
        async () => commercialJson(await tx.wallet.findUnique({ where: { tenantId } })),
        async () => {
          const ledgerId = await postTransaction(tx, tenantId, {
            type: 'CREDIT',
            amountMinor: 100n,
            reason: change.reason,
            idempotencyKey: change.idempotencyKey,
            createdBy: user.id,
          })
          return { ledgerId }
        },
      ),
    )
  const receipts = await Promise.all(Array.from({ length: 10 }, () => execute()))
  expect(new Set(receipts.map((r) => r.id)).size).toBe(1)
  expect(await db.withTenant(tenantId, (tx) => tx.walletTransaction.count())).toBe(1)
  await expect(execute({ ...input, amountMinor: 101 })).rejects.toThrow('different operation')
  await expect(
    db.withTenant(tenantId, (tx) => tx.commercialOperation.deleteMany()),
  ).rejects.toThrow(/permission denied/i)
  await expect(
    db.withTenant(tenantId, (tx) =>
      commercialOperation(
        tx,
        tenantId,
        user.id,
        { ...input, idempotencyKey: uuidv7() },
        async () => ({}),
        async () => {
          await postTransaction(tx, tenantId, {
            type: 'CREDIT',
            amountMinor: 99n,
            reason: 'rollback',
            idempotencyKey: uuidv7(),
          })
          throw new Error('simulate failure before receipt/audit')
        },
      ),
    ),
  ).rejects.toThrow('simulate failure')
  expect(
    (await db.withTenant(tenantId, (tx) => tx.wallet.findUniqueOrThrow({ where: { tenantId } })))
      .balanceMinor,
  ).toBe(100n)
  const audit = await db.withTenant(tenantId, (tx) => tx.auditLog.findMany())
  expect(audit).toHaveLength(1)
  expect(audit[0]!.actorType).toBe('PLATFORM_OPERATOR')
})

it('commercial discovery/detail is bounded, excludes customer content and isolates internal provider cost', async () => {
  const user = await privileged(),
    tenantId = uuidv7(),
    marker = `Workspace-${uuidv7()}`
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: marker, slug: tenantId },
    })
    await tx.wallet.create({ data: { tenantId } })
    await tx.usageEvent.create({
      data: {
        tenantId,
        type: 'test',
        category: 'UTILITY',
        currency: 'INR',
        unitPriceMinor: 100n,
        amountMinor: 100n,
      },
    })
    await tx.usageEvent.create({
      data: {
        tenantId,
        type: 'test',
        category: 'UTILITY',
        currency: 'INR',
        unitPriceMinor: 100n,
        amountMinor: 100n,
        providerCostMinor: 40n,
      },
    })
  })
  const found = await user.client.get(`/platform/workspaces?q=${encodeURIComponent(marker)}`)
  expect(found.status).toBe(200)
  expect(found.body.data.map((r: { id: string }) => r.id)).toContain(tenantId)
  const detail = await user.client.get(`/platform/workspaces/${tenantId}`)
  expect(detail.status, JSON.stringify(detail.body)).toBe(200)
  expect(detail.body.data.subscriptionsEnforced).toBe(false)
  expect(JSON.stringify(detail.body)).not.toContain('providerCost')
  expect(JSON.stringify(detail.body)).not.toContain('phoneE164')
  const finance = await user.client.get(`/platform/workspaces/${tenantId}/financial`)
  expect(finance.status).toBe(200)
  expect(finance.body.data).toMatchObject({
    customerChargeMinor: '200',
    providerCostMinor: '40',
    knownCostCustomerChargeMinor: '100',
    recordedContributionMinor: '60',
    messages: 2,
    costKnownMessages: 1,
  })
  expect(
    (await user.client.get(`/platform/workspaces/${tenantId}`, { 'X-Tenant-Id': uuidv7() })).status,
  ).toBe(404)
  expect((await user.client.get('/conversations', { 'X-Tenant-Id': tenantId })).status).toBe(401)
  expect((await user.client.get('/platform/workspaces?q=a')).status).toBe(400)
})

it('wallet HTTP operations preserve fund identity, idempotency, refund caps and reservation boundaries', async () => {
  const user = await privileged(),
    tenantId = uuidv7()
  await db.withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: {
        id: tenantId,
        ownerUserId: user.id,
        name: 'Wallet operations',
        slug: tenantId,
        billingMode: 'PREPAID',
      },
    }),
  )
  const command = {
    kind: 'paid_credit',
    amountMinor: 1000,
    currency: 'INR',
    reason: 'Verified manual funding',
    reference: 'bank-ref',
    idempotencyKey: uuidv7(),
  }
  const url = `/platform/workspaces/${tenantId}/wallet-operations`
  const results = await Promise.all(Array.from({ length: 8 }, () => user.client.post(url, command)))
  expect(results.map((r) => r.status)).toEqual(Array(8).fill(200))
  expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1)
  expect(results[0]!.body.data).toMatchObject({
    operatorId: user.id,
    tenantId,
    amountMinor: '1000',
    currency: 'INR',
    reason: command.reason,
    reference: command.reference,
  })
  expect((await user.client.post(url, { ...command, amountMinor: 1001 })).status).toBe(409)
  expect(
    (
      await user.client.post(url, {
        ...command,
        kind: 'promotional_credit',
        amountMinor: 200,
        idempotencyKey: uuidv7(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    ).status,
  ).toBe(200)
  const debitId = await db.withTenant(tenantId, (tx) =>
    postTransaction(tx, tenantId, {
      type: 'DEBIT',
      amountMinor: -300n,
      reason: 'usage fixture',
      referenceType: 'message',
      referenceId: uuidv7(),
      idempotencyKey: uuidv7(),
    }),
  )
  const refund = { ...command, kind: 'refund', debitId, amountMinor: 200, idempotencyKey: uuidv7() }
  expect((await user.client.post(url, refund)).status).toBe(200)
  expect((await user.client.post(url, { ...refund, idempotencyKey: uuidv7() })).status).toBe(422)
  expect(
    (await user.client.post(url, { ...refund, debitId: uuidv7(), idempotencyKey: uuidv7() }))
      .status,
  ).toBe(404)
  // A hold consumes available funds; adjustment must not take them twice.
  const category = `TEST_${uuidv7()}`.toUpperCase(),
    messageId = uuidv7()
  await owner.withGlobal((tx) =>
    tx.priceBookEntry.create({
      data: {
        category,
        customerPriceMinor: 900n,
        currency: 'INR',
        isPlaceholder: true,
        note: 'Development placeholder: isolated reservation test fixture',
      },
    }),
  )
  await db.withTenant(tenantId, (tx) =>
    reserveForMessage(tx, tenantId, { messageId, category, country: null }),
  )
  expect(
    (
      await user.client.post(url, {
        ...command,
        kind: 'adjustment',
        amountMinor: -201,
        idempotencyKey: uuidv7(),
      })
    ).status,
  ).toBe(422)
  expect(
    (
      await user.client.post(url, {
        ...command,
        kind: 'adjustment',
        amountMinor: -200,
        idempotencyKey: uuidv7(),
      })
    ).status,
  ).toBe(200)
  const wallet = await db.withTenant(tenantId, (tx) =>
    tx.wallet.findUniqueOrThrow({ where: { tenantId } }),
  )
  expect(wallet.balanceMinor).toBe(900n)
  await db.withTenant(tenantId, (tx) =>
    releaseReservation(tx, tenantId, messageId, 'test complete'),
  )
  expect(
    await db.withTenant(tenantId, (tx) =>
      tx.walletTransaction.count({ where: { fundType: 'PROMOTIONAL' } }),
    ),
  ).toBe(1)
  const audit = await db.withPlatform(user.id, (tx) =>
    tx.platformAudit.findMany({ where: { workspaceId: tenantId } }),
  )
  expect(audit.some((a) => a.outcome === 'INSUFFICIENT_BALANCE')).toBe(true)
  await db.withGlobal((tx) =>
    tx.platformSession.updateMany({
      where: { userId: user.id },
      data: { mfaAt: new Date(Date.now() - 6 * 60_000) },
    }),
  )
  expect((await user.client.post(url, { ...command, idempotencyKey: uuidv7() })).status).toBe(403)
})

it('a plan downgrade must preserve an unexpired negotiated retention override', async () => {
  const user = await identity(),
    tenantId = uuidv7()
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Retention correctness', slug: tenantId },
    })
    await activatePlan(tx, tenantId, 'BUSINESS', new Date(), { type: 'SYSTEM' }, 'GROWTH')
    await tx.tenantEntitlementOverride.create({
      data: {
        tenantId,
        key: 'analytics_retention',
        value: 500,
        reason: 'Negotiated support retention',
        createdBy: user.id,
      },
    })
  })
  await db.withTenant(tenantId, (tx) =>
    activatePlan(tx, tenantId, 'STARTER', new Date(), { type: 'SYSTEM' }, 'GROWTH'),
  )
  const override = await db.withTenant(tenantId, (tx) =>
    tx.tenantEntitlementOverride.findUniqueOrThrow({
      where: { tenantId_key: { tenantId, key: 'analytics_retention' } },
    }),
  )
  expect(override.value).toBe(500)
  expect(override.expiresAt).toBeNull()
  expect(override.reason).toBe('Negotiated support retention')
})

it('operator subscription and typed overrides use receipts without duplicating transitions', async () => {
  const user = await privileged(),
    tenantId = uuidv7()
  await db.withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Subscription operations', slug: tenantId },
    }),
  )
  const read = await user.client.get(`/platform/workspaces/${tenantId}`)
  const planId = read.body.data.plans.find((p: { key: string }) => p.key === 'GROWTH').id
  const base = {
    reason: 'Founder support approval',
    reference: 'support-6',
    idempotencyKey: uuidv7(),
  }
  const url = `/platform/workspaces/${tenantId}`
  const command = { ...base, kind: 'activate', planId, expectedVersion: read.body.data.version }
  const first = await user.client.post(`${url}/subscription-operations`, command)
  expect(first.status, JSON.stringify(first.body)).toBe(200)
  const second = await user.client.post(`${url}/subscription-operations`, command)
  expect(second.body.data.id).toBe(first.body.data.id)
  expect(first.body.data.after.subscription.currentPeriodStart).toBe(
    second.body.data.after.subscription.currentPeriodStart,
  )
  const override = {
    ...base,
    idempotencyKey: uuidv7(),
    kind: 'override_set',
    key: 'max_contacts',
    value: null,
  }
  expect((await user.client.post(`${url}/entitlement-operations`, override)).status).toBe(200)
  expect(
    (await user.client.post(`${url}/entitlement-operations`, { ...override, value: true })).status,
  ).toBe(400)
  expect(
    (
      await user.client.post(`${url}/entitlement-operations`, {
        ...override,
        idempotencyKey: uuidv7(),
        key: 'api_enabled',
        value: true,
      })
    ).status,
  ).toBe(200)
  const effective = await user.client.get(url)
  expect(
    effective.body.data.entitlements.find((e: { key: string }) => e.key === 'max_contacts')
      .configured,
  ).toBeNull()
  expect(
    (
      await user.client.post(`${url}/entitlement-operations`, {
        ...base,
        idempotencyKey: uuidv7(),
        kind: 'override_remove',
        key: 'max_contacts',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await user.client.post(`${url}/subscription-operations`, {
        ...base,
        idempotencyKey: uuidv7(),
        kind: 'billing_mode',
        mode: 'PREPAID',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await user.client.post(`${url}/subscription-operations`, {
        ...base,
        idempotencyKey: uuidv7(),
        kind: 'billing_mode',
        mode: 'POSTPAID',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await user.client.post(`${url}/subscription-operations`, {
        ...base,
        idempotencyKey: uuidv7(),
        kind: 'cancel',
      })
    ).status,
  ).toBe(200)
  const final = await user.client.get(url)
  expect(final.body.data.snapshot.subscription.status).toBe('ACTIVE')
  expect(final.body.data.snapshot.subscription.cancelAtPeriodEnd).toBe(true)
  expect(final.body.data.snapshot.workspace.billingMode).toBe('PREPAID')
  const receipts = await db.withTenant(tenantId, (tx) => tx.commercialOperation.findMany())
  expect(receipts).toHaveLength(6)
  const outbox = await db.withTenant(tenantId, (tx) =>
    tx.outboxEvent.count({ where: { eventType: 'commercial.operation_completed' } }),
  )
  expect(outbox).toBe(receipts.length)
})

it('commercial preview rolls back all financial state and stale confirmation is rejected', async () => {
  const user = await privileged(),
    tenantId = uuidv7()
  await db.withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Preview isolation', slug: tenantId },
    }),
  )
  const url = `/platform/workspaces/${tenantId}`
  const read = await user.client.get(url)
  const command = {
    kind: 'paid_credit',
    amountMinor: 500,
    currency: 'INR',
    reason: 'Reviewed manual funding',
    reference: 'preview-reference',
    idempotencyKey: uuidv7(),
    expectedVersion: read.body.data.version,
  }
  const preview = await user.client.post(`${url}/wallet-preview`, command)
  expect(preview.status, JSON.stringify(preview.body)).toBe(200)
  expect(preview.body.data.after.wallet.balanceMinor).toBe('500')
  expect(await db.withTenant(tenantId, (tx) => tx.wallet.count())).toBe(0)
  expect(await db.withTenant(tenantId, (tx) => tx.walletTransaction.count())).toBe(0)
  expect(await db.withTenant(tenantId, (tx) => tx.commercialOperation.count())).toBe(0)
  expect(
    await db.withTenant(tenantId, (tx) =>
      tx.outboxEvent.count({ where: { eventType: 'commercial.operation_completed' } }),
    ),
  ).toBe(0)
  const other = await user.client.post(`${url}/wallet-operations`, {
    ...command,
    idempotencyKey: uuidv7(),
    expectedVersion: undefined,
  })
  expect(other.status).toBe(200)
  expect((await user.client.post(`${url}/wallet-operations`, command)).status).toBe(409)
  const fresh = await user.client.get(url)
  const override = {
    kind: 'override_set',
    key: 'max_contacts',
    value: 12,
    reason: 'Preview negotiated limit',
    reference: 'preview-override',
    idempotencyKey: uuidv7(),
    expectedVersion: fresh.body.data.version,
  }
  const entitlement = await user.client.post(`${url}/entitlement-preview`, override)
  expect(entitlement.status).toBe(200)
  expect(
    entitlement.body.data.entitlements.find((e: { key: string }) => e.key === 'max_contacts')
      .configured,
  ).toBe(12)
  expect(await db.withTenant(tenantId, (tx) => tx.tenantEntitlementOverride.count())).toBe(0)
})

it('password revocation invalidates a pending platform challenge before MFA', async () => {
  const user = await identity()
  const login = await user.client.post('/platform/auth/login', {
    email: user.email,
    password: PASSWORD,
  })
  expect(login.status).toBe(200)
  await db.withGlobal((tx) =>
    tx.session.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
    }),
  )
  const verify = await user.client.post('/platform/auth/verify', {
    challengeToken: login.body.data.challengeToken,
    code: code(),
  })
  expect(verify.status).toBe(401)
  expect(
    await db.withGlobal((tx) => tx.platformSession.count({ where: { userId: user.id } })),
  ).toBe(0)
})

it('independent concurrent negative corrections and refunds cannot overspend', async () => {
  const user = await privileged(),
    tenantId = uuidv7()
  await db.withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: {
        id: tenantId,
        ownerUserId: user.id,
        name: 'Concurrent financial support',
        slug: tenantId,
      },
    }),
  )
  const url = `/platform/workspaces/${tenantId}/wallet-operations`
  const base = { currency: 'INR', reason: 'Approved concurrent support', reference: 'race-support' }
  expect(
    (
      await user.client.post(url, {
        ...base,
        kind: 'paid_credit',
        amountMinor: 1000,
        idempotencyKey: uuidv7(),
      })
    ).status,
  ).toBe(200)
  const corrections = await Promise.all(
    Array.from({ length: 2 }, () =>
      user.client.post(url, {
        ...base,
        kind: 'adjustment',
        amountMinor: -600,
        idempotencyKey: uuidv7(),
      }),
    ),
  )
  expect(corrections.map((r) => r.status).sort()).toEqual([200, 422])
  const debitId = await db.withTenant(tenantId, (tx) =>
    postTransaction(tx, tenantId, {
      type: 'DEBIT',
      amountMinor: -300n,
      reason: 'usage debit',
      referenceType: 'message',
      referenceId: uuidv7(),
      idempotencyKey: uuidv7(),
    }),
  )
  const refunds = await Promise.all(
    Array.from({ length: 4 }, () =>
      user.client.post(url, {
        ...base,
        kind: 'refund',
        debitId,
        amountMinor: 100,
        idempotencyKey: uuidv7(),
      }),
    ),
  )
  expect(refunds.map((r) => r.status).sort()).toEqual([200, 200, 200, 422])
  expect(
    (await db.withTenant(tenantId, (tx) => tx.wallet.findUniqueOrThrow({ where: { tenantId } })))
      .balanceMinor,
  ).toBe(400n)
  const entries = await db.withTenant(tenantId, (tx) => tx.walletTransaction.findMany())
  expect(
    entries.filter((e) => e.type === 'REFUND').reduce((sum, e) => sum + e.amountMinor, 0n),
  ).toBe(300n)
})

it('every protected platform route rejects tenant-only callers and invalid requests have immutable failure audit', async () => {
  const tenant = await identity(false, false)
  expect(
    (await tenant.client.post('/auth/login', { email: tenant.email, password: PASSWORD })).status,
  ).toBe(200)
  const id = uuidv7()
  for (const path of [
    '/platform/auth/me',
    '/platform/workspaces?q=workspace',
    `/platform/workspaces/${id}`,
    `/platform/workspaces/${id}/financial`,
    `/platform/workspaces/${id}/operations`,
    '/platform/audit',
  ])
    expect((await tenant.client.get(path)).status).toBe(401)
  for (const path of [
    'wallet-operations',
    'subscription-operations',
    'entitlement-operations',
    'wallet-preview',
    'subscription-preview',
    'entitlement-preview',
  ])
    expect((await tenant.client.post(`/platform/workspaces/${id}/${path}`, {})).status).toBe(401)
  const operator = await privileged()
  const invalid = await operator.client.post(`/platform/workspaces/${id}/wallet-operations`, {
    password: 'never-record-this-secret',
    amountMinor: 1,
  })
  expect(invalid.status).toBe(400)
  const audits = await db.withPlatform(operator.id, (tx) =>
    tx.platformAudit.findMany({ where: { operatorId: operator.id, outcome: 'VALIDATION_FAILED' } }),
  )
  expect(audits.length).toBeGreaterThan(0)
  expect(JSON.stringify(audits)).not.toContain('never-record-this-secret')
  expect((await operator.client.get('/platform/auth/me')).headers['cache-control']).toBe('no-store')
})

it('successive downgrades preserve and renew the original automatic retention grace', async () => {
  const user = await identity(),
    tenantId = uuidv7(),
    start = new Date()
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, ownerUserId: user.id, name: 'Grace correctness', slug: tenantId },
    })
    await activatePlan(tx, tenantId, 'BUSINESS', start, { type: 'SYSTEM' }, 'GROWTH')
    await activatePlan(tx, tenantId, 'GROWTH', start, { type: 'SYSTEM' }, 'GROWTH')
    await activatePlan(
      tx,
      tenantId,
      'STARTER',
      new Date(start.getTime() + 86400000),
      { type: 'SYSTEM' },
      'GROWTH',
    )
  })
  const override = await db.withTenant(tenantId, (tx) =>
    tx.tenantEntitlementOverride.findUniqueOrThrow({
      where: { tenantId_key: { tenantId, key: 'analytics_retention' } },
    }),
  )
  expect(override.value).toBe(365)
  expect(override.expiresAt?.getTime()).toBe(start.getTime() + 31 * 86400000)
})

it('commercial notifications reach billing readers once and exclude operator/customer-sensitive payloads', async () => {
  const operator = await privileged(),
    customer = await identity(false, false),
    tenantId = uuidv7()
  await db.withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        ownerUserId: customer.id,
        name: 'Billing recipient fixture',
        slug: tenantId,
      },
    })
    await tx.membership.create({
      data: { tenantId, userId: customer.id, role: 'OWNER', status: 'ACTIVE' },
    })
  })
  const result = await operator.client.post(`/platform/workspaces/${tenantId}/wallet-operations`, {
    kind: 'paid_credit',
    amountMinor: 100,
    currency: 'INR',
    reason: 'Private support reference',
    reference: 'private-funding-record',
    idempotencyKey: uuidv7(),
  })
  expect(result.status).toBe(200)
  const toUser = vi.fn()
  const processor = new NotificationsDispatchProcessor(
    db,
    { enforced: false } as never,
    {} as never,
    {} as never,
    { toUser } as never,
    {} as never,
    { setContext: vi.fn() } as never,
    {} as never,
  )
  const job = {
    data: {
      tenantId,
      eventType: 'commercial.operation_completed',
      payload: { operationId: result.body.data.id },
    },
  } as never
  await Promise.all([processor.process(job), processor.process(job)])
  const notifications = await db.withTenant(tenantId, (tx) =>
    tx.notification.findMany({ where: { type: 'commercial.operation_completed' } }),
  )
  expect(notifications).toHaveLength(1)
  expect(notifications[0]!.userId).toBe(customer.id)
  expect(JSON.stringify(notifications)).not.toContain('private-funding-record')
  expect(toUser).toHaveBeenCalledTimes(1)
  expect(
    await db.withTenant(tenantId, (tx) => tx.membership.count({ where: { userId: operator.id } })),
  ).toBe(0)
})
