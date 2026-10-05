import { commercialOperation, commercialJson } from '@fenwira/api/modules/platform-operations'
import { postTransaction } from '@fenwira/api/modules/billing'
import { encryptSecret, uuidv7 } from '@fenwira/config'
import {
  IDENTITY_OPTIONS,
  type IdentityOptions,
  PasswordService,
  totpAt,
} from '@fenwira/api/modules/identity'
import { Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, expect, it } from 'vitest'
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
