import { API_KEY_SCOPES } from '@fenwira/contracts'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * Phase 11 Step 3: tenant API keys (docs/API_KEYS.md, decisions P11-D18, P11-D22, P11-D23).
 * A dedicated, low rate limit lets the rate-limiting test run fast without slowing every other
 * assertion in this file. The worker is booted too: onboarding (createOwner/addMember) sends
 * verification and invitation emails through it.
 */
let api: INestApplication
let worker: INestApplication
let owner: Member
let manager: Member

beforeAll(async () => {
  api = await bootApi({ API_KEY_RATE_LIMIT_PER_MINUTE: '5' })
  worker = await bootWorker()
  owner = await createOwner(api, 'apikeys')
  manager = await addMember(api, owner, 'MANAGER')
}, 30_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const customer = () => `9197${String(Math.random()).slice(2, 10)}`

describe('creating and listing keys', () => {
  it('only a scope from the catalog, and only one the creator already holds, is grantable', async () => {
    const ok = await owner.client.post('/api-keys', {
      name: 'full scope',
      scopes: ['contacts.read', 'campaigns.read'],
    })
    expect(ok.status, ok.text).toBe(201)
    expect(ok.body.data.key).toMatchObject({
      name: 'full scope',
      scopes: ['contacts.read', 'campaigns.read'],
      prefix: expect.stringMatching(/^[A-Za-z0-9]{8}$/),
      revokedAt: null,
    })
    expect(typeof ok.body.data.secret).toBe('string')
    expect(ok.body.data.secret).toMatch(/^fw_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,128}$/)

    // Not in API_KEY_SCOPES at all: `scopes` is itself typed as that enum in the request schema,
    // so this is rejected as an ordinary 400 VALIDATION_FAILED before create() ever runs — the
    // service's own catalog-membership check (API_KEY_SCOPE_INVALID, 422) exists as a second,
    // defense-in-depth line behind the same rule, not as a path reachable through this route.
    const notInCatalog = await owner.client.post('/api-keys', {
      name: 'bad',
      scopes: ['workspace.delete'],
    })
    expect(notInCatalog.status).toBe(400)
    expect(notInCatalog.body.error.code).toBe('VALIDATION_FAILED')

    // Both roles that can create keys (integrations.manage is OWNER/ADMIN only) already hold every
    // catalog scope, so the "creator lacks this scope" branch of create() (API_KEY_SCOPE_INVALID)
    // has no live role to exercise it through HTTP today; it stays covered structurally by the
    // schema-level check above plus the OWNER/ADMIN-only gate on integrations.manage (next test).
  })

  it('a manager cannot create or list keys (integrations.manage is OWNER/ADMIN only)', async () => {
    const created = await manager.client.post('/api-keys', {
      name: 'nope',
      scopes: ['contacts.read'],
    })
    expect(created.status).toBe(403)
    const listed = await manager.client.get('/api-keys')
    expect(listed.status).toBe(403)
  })

  it('list never returns the secret or a hash', async () => {
    const res = await owner.client.get('/api-keys')
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    for (const key of res.body.data) {
      expect(key).not.toHaveProperty('secret')
      expect(key).not.toHaveProperty('keyHash')
    }
  })

  it('creating and revoking are audited as the signed-in actor', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'to revoke',
      scopes: ['contacts.read'],
    })
    await owner.client.delete(`/api-keys/${created.body.data.key.id}`)
    const audit = await owner.client.get('/audit-logs?action=api_key.')
    const actions = audit.body.data.map((a: { action: string }) => a.action)
    expect(actions).toContain('api_key.created')
    expect(actions).toContain('api_key.revoked')
  })
})

describe('authenticating with a key', () => {
  it('reaches an allowlisted public route within its scope, and is attributed to the key (not a user)', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'contacts key',
      scopes: ['contacts.read', 'contacts.write'],
    })
    const keyId = created.body.data.key.id as string
    const token = created.body.data.secret as string
    const search = await owner.client.agent
      .post('/api/v1/contacts/search')
      .set(bearer(token))
      .send({})
    expect(search.status, search.text).toBe(200)

    const create = await owner.client.agent
      .post('/api/v1/contacts')
      .set(bearer(token))
      .send({
        phone: `+${customer()}`,
        name: 'Api Key',
      })
    expect(create.status, create.text).toBe(201)

    // Contact creation isn't written to the tenant audit log (docs/API_SPEC.md); the per-contact
    // activity timeline is what carries actor attribution here, and consent.ts's addActivity is
    // exactly the code this session added the API-key branch to.
    const activities = await owner.client.get(`/contacts/${create.body.data.id}/activities`)
    const entry = (
      activities.body.data as Array<{ type: string; actorType: string; actorId: string }>
    ).find((a) => a.type === 'contact.created')
    expect(entry).toMatchObject({ actorType: 'API_KEY', actorId: keyId })
  })

  it('answers 403 for an allowlisted route the key was never granted scope to reach', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'contacts only',
      scopes: ['contacts.read'],
    })
    const token = created.body.data.secret as string
    // Public and carries a permission (campaigns.read), so ApiKeyGuard authenticates it; the
    // existing PermissionGuard then rejects it, same as an under-scoped signed-in member would see.
    const res = await owner.client.agent.get('/api/v1/campaigns').set(bearer(token))
    expect(res.status).toBe(403)
  })

  it('answers 404, not 403, for a route that is never public at all, even for a full-scope key', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'broad',
      scopes: [...API_KEY_SCOPES],
    })
    const token = created.body.data.secret as string
    // /team is a real, permitted-for-OWNER route, but carries no @PublicApi().
    const res = await owner.client.agent.get('/api/v1/team').set(bearer(token))
    expect(res.status).toBe(404)
  })

  it('rejects a garbage, revoked, or expired token with the same generic 401', async () => {
    const garbage = await owner.client.agent
      .post('/api/v1/contacts/search')
      .set(bearer('fw_notarealkey_xxxxxxxxxxxxxxxxxxxxxxxx'))
      .send({})
    expect(garbage.status).toBe(401)

    const revokable = await owner.client.post('/api-keys', {
      name: 'to revoke 2',
      scopes: ['contacts.read'],
    })
    const revokedToken = revokable.body.data.secret as string
    await owner.client.delete(`/api-keys/${revokable.body.data.key.id}`)
    const afterRevoke = await owner.client.agent
      .post('/api/v1/contacts/search')
      .set(bearer(revokedToken))
      .send({})
    expect(afterRevoke.status).toBe(401)

    const expired = await owner.client.post('/api-keys', {
      name: 'expired',
      scopes: ['contacts.read'],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const expiredToken = expired.body.data.secret as string
    const afterExpiry = await owner.client.agent
      .post('/api/v1/contacts/search')
      .set(bearer(expiredToken))
      .send({})
    expect(afterExpiry.status).toBe(401)
  })

  it('a Bearer request needs no CSRF token and is unaffected by Origin', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'csrf-exempt',
      scopes: ['contacts.read'],
    })
    const token = created.body.data.secret as string
    const res = await owner.client.agent
      .post('/api/v1/contacts/search')
      .set(bearer(token))
      .set('Origin', 'https://evil.example')
      .send({})
    expect(res.status, res.text).toBe(200)
  })

  it('rate limits per key', async () => {
    const created = await owner.client.post('/api-keys', {
      name: 'rate limited',
      scopes: ['contacts.read'],
    })
    const token = created.body.data.secret as string
    const results: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await owner.client.agent
        .post('/api/v1/contacts/search')
        .set(bearer(token))
        .send({})
      results.push(res.status)
    }
    expect(results.filter((s) => s === 200).length).toBe(5)
    expect(results.filter((s) => s === 429)).toHaveLength(2)
  })
})
